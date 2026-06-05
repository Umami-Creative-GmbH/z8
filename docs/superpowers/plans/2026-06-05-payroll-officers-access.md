# Payroll Officers Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make payroll workspace access opt-in for explicitly granted payroll officers, while using CASL to protect payroll officer settings.

**Architecture:** Keep the existing `payroll_access_*` tables as the source of truth for payroll workspace access. Add a CASL `PayrollOfficerSettings` subject for managing officer grants, remove all admin bypasses from payroll workspace scope resolution, and show Payroll navigation only for employees with active grants.

**Tech Stack:** Next.js App Router, TypeScript, CASL, Drizzle ORM, Effect server actions, Vitest, Testing Library, TanStack Form, Tolgee.

---

## Scope Check

This is a targeted correction to the existing scoped payroll access implementation. It does not require new database tables or migrations. The work is one cohesive authorization change with CASL settings authorization, server action scoping, sidebar visibility, and copy/tests.

## File Structure

- Modify `apps/webapp/src/lib/authorization/types.ts`: add `PayrollOfficerSettings` to organization subjects and subject map.
- Modify `apps/webapp/src/lib/authorization/ability.ts`: grant `manage PayrollOfficerSettings` to Better Auth org owners/admins.
- Modify `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`: cover owner/admin/member and employee-admin behavior.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.ts`: remove admin bypass from scoped payroll employee resolution.
- Create `apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.test.ts`: focused tests for no role-based payroll scope bypass.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`: always resolve active grant scope and remove global admin fallback.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`: assert the helper remains the action scope boundary.
- Modify `apps/webapp/src/components/server-app-sidebar.tsx`: remove admin role shortcut for Payroll nav.
- Modify `apps/webapp/src/components/app-sidebar.test.tsx`: cover admin without grant hidden, admin with grant visible, manager/employee with grant visible.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.ts`: rename helper context around payroll officer settings and add pure CASL-like assertion input.
- Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts`: focused tests for settings authorization and validation.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts`: use `requireAbility()` and CASL `manage PayrollOfficerSettings` instead of `requireAdmin()`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx`: update title and denial copy to “Payroll Officers”.
- Modify `apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx`: update visible copy and Tolgee defaults to “Payroll Officers”.
- Modify `apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx`: update UI copy assertions.

## Task 1: CASL Payroll Officer Settings Subject

**Files:**
- Modify: `apps/webapp/src/lib/authorization/types.ts`
- Modify: `apps/webapp/src/lib/authorization/ability.ts`
- Modify: `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

- [ ] **Step 1: Write failing CASL ability tests**

Add these tests to the existing `Organization Owner`, `Organization Admin`, `Organization Member`, and `Employee Admin` sections in `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`:

```ts
it("can manage payroll officer settings", () => {
	const ability = defineAbilityFor(ownerPrincipal);

	expect(ability.can("manage", "PayrollOfficerSettings")).toBe(true);
});
```

```ts
it("can manage payroll officer settings", () => {
	const ability = defineAbilityFor(adminPrincipal);

	expect(ability.can("manage", "PayrollOfficerSettings")).toBe(true);
});
```

```ts
it("cannot manage payroll officer settings", () => {
	const ability = defineAbilityFor(memberPrincipal);

	expect(ability.can("manage", "PayrollOfficerSettings")).toBe(false);
});
```

```ts
it("cannot manage payroll officer settings through employee admin role alone", () => {
	const ability = defineAbilityFor(empAdminPrincipal);

	expect(ability.can("manage", "PayrollOfficerSettings")).toBe(false);
});
```

- [ ] **Step 2: Run CASL tests to verify they fail**

Run: `pnpm --filter @z8/webapp test src/lib/authorization/__tests__/ability.test.ts`

Expected: FAIL because `PayrollOfficerSettings` is not yet a valid subject.

- [ ] **Step 3: Add the CASL subject type**

In `apps/webapp/src/lib/authorization/types.ts`, add `PayrollOfficerSettings` to `OrganizationSubject` near `PayrollExport`:

```ts
	| "PayrollExport" // Payroll export configuration
	| "PayrollOfficerSettings" // Payroll officer access grants
```

Then add it to `SubjectTypeMap` near `PayrollExport`:

```ts
	PayrollExport: OrgScopedSubject;
	PayrollOfficerSettings: OrgScopedSubject;
```

- [ ] **Step 4: Grant settings access to org owners/admins**

In `apps/webapp/src/lib/authorization/ability.ts`, add this in both the Better Auth `owner` and `admin` branches directly after `can("manage", "PayrollExport")`:

```ts
			can("manage", "PayrollOfficerSettings");
```

Do not add this to employee-role `admin` rules.

- [ ] **Step 5: Run CASL tests**

Run: `pnpm --filter @z8/webapp test src/lib/authorization/__tests__/ability.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/authorization/types.ts apps/webapp/src/lib/authorization/ability.ts apps/webapp/src/lib/authorization/__tests__/ability.test.ts
git commit -m "fix(payroll): add officer settings permission"
```

## Task 2: Remove Payroll Workspace Admin Scope Bypass

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveScopedPayrollEmployeeIdsForAction } from "./action-helpers";

describe("resolveScopedPayrollEmployeeIdsForAction", () => {
	it("does not give admins global payroll scope", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				allowedEmployeeIds: [],
			}),
		).toEqual({ employeeIds: [], hasScope: false });
	});

	it("intersects admin requested employees with active grant scope", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				allowedEmployeeIds: ["employee-1", "employee-2"],
				requestedEmployeeIds: ["employee-2", "employee-3"],
			}),
		).toEqual({ employeeIds: ["employee-2"], hasScope: true });
	});

	it("returns all allowed employees when no filter is requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "manager",
				allowedEmployeeIds: ["employee-2", "employee-1"],
			}),
		).toEqual({ employeeIds: ["employee-1", "employee-2"], hasScope: true });
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/payroll/action-helpers.test.ts'`

Expected: FAIL because admins currently bypass grant scope.

- [ ] **Step 3: Remove the admin branch**

Replace `resolveScopedPayrollEmployeeIdsForAction` in `apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.ts` with:

```ts
export function resolveScopedPayrollEmployeeIdsForAction(input: {
	role: PayrollWorkspaceActorRole;
	requestedEmployeeIds?: string[];
	allowedEmployeeIds: string[];
}): ScopedPayrollEmployeeIdsForAction {
	const employeeIds = intersectPayrollScope({
		allowedEmployeeIds: input.allowedEmployeeIds,
		requestedEmployeeIds: input.requestedEmployeeIds,
	});

	return { employeeIds, hasScope: employeeIds.length > 0 };
}
```

Keep the `role` property in the input type for now so existing call sites and tests remain explicit about role, even though role no longer changes payroll data scope.

- [ ] **Step 4: Update payroll actions to always resolve grant scope**

In `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`, replace the `allowedEmployeeIds` assignment in `resolvePayrollWorkspaceActionContext` with:

```ts
	const allowedEmployeeIds = await resolvePayrollAccessibleEmployeeIds({
		organizationId: authContext.employee.organizationId,
		payrollEmployeeId: authContext.employee.id,
	});
```

Replace the following admin-specific check:

```ts
	if (authContext.employee.role !== "admin" && allowedEmployeeIds.length === 0) {
```

with:

```ts
	if (allowedEmployeeIds.length === 0) {
```

In `buildScopedPayrollWorkspaceSummary`, replace:

```ts
		allowedEmployeeIds: scopedEmployeeIds ?? (await getActiveOrganizationEmployeeIds(authContext)),
```

with:

```ts
		allowedEmployeeIds: scopedEmployeeIds,
```

Delete the now-unused `getActiveOrganizationEmployeeIds` function and remove unused imports `employee`, `and`, and `eq` if TypeScript reports them unused.

- [ ] **Step 5: Strengthen action scope smoke test**

In `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`, add this test:

```ts
it("keeps admin requests constrained by active payroll grant scope", async () => {
	const { resolveScopedPayrollEmployeeIdsForAction } = await import("./action-helpers");

	expect(
		resolveScopedPayrollEmployeeIdsForAction({
			role: "admin",
			allowedEmployeeIds: ["employee-1"],
			requestedEmployeeIds: ["employee-1", "employee-2"],
		}),
	).toEqual({ employeeIds: ["employee-1"], hasScope: true });
});
```

- [ ] **Step 6: Run payroll action tests**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/payroll/action-helpers.test.ts' 'src/app/[locale]/(app)/payroll/actions.test.ts'`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.ts' 'apps/webapp/src/app/[locale]/(app)/payroll/action-helpers.test.ts' 'apps/webapp/src/app/[locale]/(app)/payroll/actions.ts' 'apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts'
git commit -m "fix(payroll): require officer grants for workspace access"
```

## Task 3: Restrict Payroll Navigation To Active Grants

**Files:**
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Add failing sidebar tests**

In `apps/webapp/src/components/app-sidebar.test.tsx`, add tests near the existing `ServerAppSidebar` tests. Reuse the existing mocks in that file, especially `hasActivePayrollAccessGrantMock`.

```ts
it("hides payroll navigation for admins without an active payroll grant", async () => {
	vi.stubEnv("BILLING_ENABLED", "false");
	canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
	getUserOrganizationsMock.mockResolvedValue([{ id: "org_1", name: "Org", slug: "org", logo: null }]);
	getAuthContextMock.mockResolvedValue({
		user: { role: "user" },
		session: { activeOrganizationId: "org_1" },
		employee: { id: "employee-admin", organizationId: "org_1", role: "admin" },
	});
	getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
	hasActivePayrollAccessGrantMock.mockResolvedValue(false);

	vi.doMock("@/lib/auth-helpers", () => ({
		getUserOrganizations: getUserOrganizationsMock,
		getAuthContext: getAuthContextMock,
		getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
		requireAbility: requireAbilityMock,
	}));
	vi.doMock("@/lib/payroll-access/permissions", () => ({
		hasActivePayrollAccessGrant: hasActivePayrollAccessGrantMock,
	}));

	const { ServerAppSidebar } = await import("./server-app-sidebar");
	render(await ServerAppSidebar({}));

	expect(screen.queryByRole("link", { name: "Payroll" })).toBeNull();
	expect(hasActivePayrollAccessGrantMock).toHaveBeenCalledWith({
		organizationId: "org_1",
		payrollEmployeeId: "employee-admin",
	});
});
```

```ts
it("shows payroll navigation for admins with an active payroll grant", async () => {
	vi.stubEnv("BILLING_ENABLED", "false");
	canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
	getUserOrganizationsMock.mockResolvedValue([{ id: "org_1", name: "Org", slug: "org", logo: null }]);
	getAuthContextMock.mockResolvedValue({
		user: { role: "user" },
		session: { activeOrganizationId: "org_1" },
		employee: { id: "employee-admin", organizationId: "org_1", role: "admin" },
	});
	getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
	hasActivePayrollAccessGrantMock.mockResolvedValue(true);

	vi.doMock("@/lib/auth-helpers", () => ({
		getUserOrganizations: getUserOrganizationsMock,
		getAuthContext: getAuthContextMock,
		getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
		requireAbility: requireAbilityMock,
	}));
	vi.doMock("@/lib/payroll-access/permissions", () => ({
		hasActivePayrollAccessGrant: hasActivePayrollAccessGrantMock,
	}));

	const { ServerAppSidebar } = await import("./server-app-sidebar");
	render(await ServerAppSidebar({}));

	expect(screen.getByRole("link", { name: "Payroll" }).getAttribute("href")).toBe("/payroll");
});
```

If the local fixture type requires more organization fields, include the same fields used by nearby tests: `shiftsEnabled`, `projectsEnabled`, `surchargesEnabled`, `demoDataEnabled`, and `worksCouncilEnabled`.

- [ ] **Step 2: Run sidebar tests to verify first test fails**

Run: `pnpm --filter @z8/webapp test src/components/app-sidebar.test.tsx`

Expected: FAIL because admins currently see Payroll without calling `hasActivePayrollAccessGrant`.

- [ ] **Step 3: Remove admin nav shortcut**

In `apps/webapp/src/components/server-app-sidebar.tsx`, replace the `showPayrollNav` block with:

```ts
	let showPayrollNav = false;
	if (
		activeEmployee &&
		activeOrganizationId &&
		activeEmployee.organizationId === activeOrganizationId
	) {
		showPayrollNav = await hasActivePayrollAccessGrant({
			organizationId: activeOrganizationId,
			payrollEmployeeId: activeEmployee.id,
		});
	}
```

- [ ] **Step 4: Run sidebar tests**

Run: `pnpm --filter @z8/webapp test src/components/app-sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "fix(payroll): hide nav without officer grant"
```

## Task 4: Protect Payroll Officer Settings With CASL

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts`

- [ ] **Step 1: Write failing settings helper tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/effect/errors";
import { assertPayrollOfficerSettingsContext } from "./action-helpers";

describe("assertPayrollOfficerSettingsContext", () => {
	it("allows active-org users with CASL manage permission", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: true,
				},
				"read",
			),
		).not.toThrow();
	});

	it("rejects users without CASL manage permission", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: false,
				},
				"write",
			),
		).toThrow(AuthorizationError);
	});
});
```

- [ ] **Step 2: Run settings helper tests to verify they fail**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts'`

Expected: FAIL because `assertPayrollOfficerSettingsContext` does not exist.

- [ ] **Step 3: Add CASL-aware settings assertion**

In `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.ts`, replace `PayrollAccessAdminContextInput` and `assertPayrollAccessAdminContext` with:

```ts
export interface PayrollOfficerSettingsContextInput {
	userId?: string;
	employeeOrganizationId: string | null;
	activeOrganizationId: string | null;
	canManagePayrollOfficerSettings: boolean;
}

export function assertPayrollOfficerSettingsContext(
	context: PayrollOfficerSettingsContextInput,
	action: "read" | "write",
): void {
	if (!context.activeOrganizationId || !context.employeeOrganizationId) {
		throw new AuthenticationError({ message: "Authentication required", userId: context.userId });
	}

	if (context.employeeOrganizationId !== context.activeOrganizationId) {
		throw new AuthorizationError({
			message: "Active organization employee context is required",
			userId: context.userId,
			resource: "PayrollOfficerSettings",
			action,
		});
	}

	if (!context.canManagePayrollOfficerSettings) {
		throw new AuthorizationError({
			message: "Payroll officer settings access required",
			userId: context.userId,
			resource: "PayrollOfficerSettings",
			action,
		});
	}
}
```

- [ ] **Step 4: Update settings action imports and context resolver**

In `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts`, replace:

```ts
import { type AuthContext, requireAdmin } from "@/lib/auth-helpers";
```

with:

```ts
import { type AuthContext, requireAbility, requireAuth } from "@/lib/auth-helpers";
```

Replace the helper import names:

```ts
	assertPayrollAccessAdminContext,
```

with:

```ts
	assertPayrollOfficerSettingsContext,
```

Replace `requirePayrollAccessAdminContext` with:

```ts
async function requirePayrollAccessAdminContext(
	action: "read" | "write",
): Promise<AuthContext & { employee: NonNullable<AuthContext["employee"]> }> {
	try {
		const [authContext, ability] = await Promise.all([requireAuth(), requireAbility()]);
		assertPayrollOfficerSettingsContext(
			{
				userId: authContext.user.id,
				employeeOrganizationId: authContext.employee?.organizationId ?? null,
				activeOrganizationId: authContext.session.activeOrganizationId,
				canManagePayrollOfficerSettings: ability.can("manage", "PayrollOfficerSettings"),
			},
			action,
		);

		return authContext as AuthContext & { employee: NonNullable<AuthContext["employee"]> };
	} catch (error) {
		if (isAppError(error)) throw error;
		if (error instanceof Error && error.message === "Authentication required") {
			throw new AuthenticationError({ message: "Authentication required" });
		}
		throw error;
	}
}
```

Keep the function name `requirePayrollAccessAdminContext` only if minimizing rename churn is preferred; otherwise rename it to `requirePayrollOfficerSettingsContext` and update the two call sites in this file.

- [ ] **Step 5: Run settings helper tests**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts'`

Expected: PASS.

- [ ] **Step 6: Run TypeScript or targeted tests for actions**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts'`

Expected: PASS. If TypeScript reports unused imports during broader verification, remove them immediately.

- [ ] **Step 7: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.ts' 'apps/webapp/src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts' 'apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts'
git commit -m "fix(payroll): protect officer settings with casl"
```

## Task 5: Rename User-Facing Copy To Payroll Officers

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx`
- Modify: `apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx`
- Modify: `apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx`

- [ ] **Step 1: Update failing UI copy tests**

In `apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx`, replace assertions that expect `Payroll access` with `Payroll Officers`. Add this assertion if it does not exist:

```ts
expect(screen.getByText("Payroll Officers")).toBeTruthy();
expect(
	screen.getByText(
		"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
	),
).toBeTruthy();
```

- [ ] **Step 2: Run form test to verify it fails**

Run: `pnpm --filter @z8/webapp test src/components/settings/payroll-access/payroll-access-form.test.tsx`

Expected: FAIL because the current copy says “Payroll access”.

- [ ] **Step 3: Update settings page copy**

In `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx`, replace the denial card copy with:

```tsx
<CardTitle>Payroll officer settings access required</CardTitle>
<CardDescription>
	Only authorized organization admins can manage payroll officers.
</CardDescription>
```

Replace the page heading block with:

```tsx
<div className="space-y-2">
	<h1 className="text-3xl font-semibold tracking-tight">Payroll Officers</h1>
	<p className="text-muted-foreground">
		Activate payroll officers and assign the teams or employees they can include in payroll workflows.
	</p>
</div>
```

- [ ] **Step 4: Update form copy**

In `apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx`, update these defaults:

```tsx
toast.success(t("settings.payrollAccess.saved", "Payroll officer settings saved"));
```

```tsx
result.error ||
	t("settings.payrollAccess.saveFailed", "Failed to save payroll officer settings")
```

```tsx
<CardTitle>{t("settings.payrollAccess.title", "Payroll Officers")}</CardTitle>
```

```tsx
"Activate payroll officers and assign the teams or employees they can include in payroll workflows."
```

```tsx
`${initialGrants.length} active payroll officer${initialGrants.length === 1 ? "" : "s"}`
```

```tsx
{t("settings.payrollAccess.payrollEmployee", "Payroll officer")}
```

```tsx
{t("settings.payrollAccess.save", "Save payroll officer")}
```

- [ ] **Step 5: Run form tests**

Run: `pnpm --filter @z8/webapp test src/components/settings/payroll-access/payroll-access-form.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx' apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx
git commit -m "chore(payroll): rename access settings to officers"
```

## Task 6: Final Verification

**Files:**
- Verify only; no code changes unless a test or type error identifies a concrete issue.

- [ ] **Step 1: Run focused payroll and authorization tests**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/authorization/__tests__/ability.test.ts 'src/app/[locale]/(app)/payroll/action-helpers.test.ts' 'src/app/[locale]/(app)/payroll/actions.test.ts' 'src/app/[locale]/(app)/settings/payroll-access/action-helpers.test.ts' src/components/app-sidebar.test.tsx src/components/settings/payroll-access/payroll-access-form.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run existing payroll access tests**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/payroll-access/permissions.test.ts src/components/settings/payroll-access/payroll-access-form.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run lint/type/build check used by this repo**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. If build is too slow or blocked by unrelated environment issues, record the exact failure and complete the focused test suite instead.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff -- apps/webapp/src/lib/authorization/types.ts apps/webapp/src/lib/authorization/ability.ts apps/webapp/src/lib/authorization/__tests__/ability.test.ts 'apps/webapp/src/app/[locale]/(app)/payroll' 'apps/webapp/src/app/[locale]/(app)/settings/payroll-access' apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx
```

Expected: Diff only contains the CASL subject, opt-in payroll scope enforcement, nav visibility correction, settings authorization correction, tests, and copy changes.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix(payroll): complete officer access hardening"
```

If no fixes were needed, no commit is required.

## Self-Review Notes

- Spec coverage: CASL settings boundary is covered in Task 1 and Task 4. Opt-in workspace access is covered in Task 2. Payroll nav visibility is covered in Task 3. UI naming is covered in Task 5. Verification is covered in Task 6.
- Placeholder scan: no placeholder language remains. Optional branches are limited to adapting nearby test fixture field requirements and unused imports reported by TypeScript.
- Type consistency: `PayrollOfficerSettings` is used consistently as the CASL subject. `payroll_access_*` remains the grant source of truth. `PayrollExport` remains export configuration, not officer workspace access.
