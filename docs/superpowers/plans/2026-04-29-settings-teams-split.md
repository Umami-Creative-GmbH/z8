# Settings Teams Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Organization and Teams into separate settings entries, keep Teams manager-visible, and refresh the Teams panel after mutations.

**Architecture:** Keep the existing server-rendered settings routes. Make `/settings/organizations` an org-admin-only organization/member/invitation page, keep `/settings/teams` as the manager-visible teams page, and use `router.refresh()` in the client teams surface to resync server props after mutations.

**Tech Stack:** Next.js App Router, React client components, TanStack Query mutations, Better Auth organization schema, Vitest.

---

## File Structure

- Modify `apps/webapp/src/components/settings/settings-config.ts`: rename the organization settings entry and add a dedicated teams entry.
- Modify `apps/webapp/src/lib/settings-access.ts`: add `/settings/organizations` to org-admin-only route checks.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`: remove teams data loading and render only organization management data.
- Modify `apps/webapp/src/components/organization/organizations-page-client.tsx`: remove tabbed teams UI and keep only `OrganizationTab`.
- Modify `apps/webapp/src/components/organization/teams-tab.tsx`: add manual refresh and call `router.refresh()` after create, edit, and delete success.
- Modify `apps/webapp/src/components/settings/settings-config.test.ts`: assert the new manager/org-admin visibility split.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`: assert the new access split and page responsibilities.

### Task 1: Settings Navigation Split

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`

- [ ] **Step 1: Write failing settings visibility tests**

In `apps/webapp/src/components/settings/settings-config.test.ts`, update the manager test to expect `teams` instead of `organizations` and add org-admin coverage for both entries:

```ts
it("shows teams but not organization management for managers", () => {
	const entries = getVisibleSettings("manager", true);

	expect(entries.some((entry) => entry.id === "teams")).toBe(true);
	expect(entries.some((entry) => entry.id === "organizations")).toBe(false);
	expect(entries.some((entry) => entry.id === "statistics")).toBe(true);
	expect(entries.some((entry) => entry.id === "calendar")).toBe(true);
	expect(entries.some((entry) => entry.id === "change-policies")).toBe(true);
	expect(entries.some((entry) => entry.id === "employees")).toBe(true);
	expect(entries.some((entry) => entry.id === "holidays")).toBe(true);
	expect(entries.some((entry) => entry.id === "locations")).toBe(true);
	expect(entries.some((entry) => entry.id === "skills")).toBe(true);
	expect(entries.some((entry) => entry.id === "vacation")).toBe(true);
	expect(entries.some((entry) => entry.id === "work-categories")).toBe(true);
	expect(entries.some((entry) => entry.id === "work-policies")).toBe(true);
	expect(entries.some((entry) => entry.id === "shift-templates")).toBe(true);
	expect(entries.some((entry) => entry.id === "coverage-rules")).toBe(true);
	expect(entries.some((entry) => entry.id === "projects")).toBe(true);
	expect(entries.some((entry) => entry.id === "customers")).toBe(true);
	expect(entries.some((entry) => entry.id === "surcharges")).toBe(true);
	expect(entries.some((entry) => entry.id === "billing")).toBe(false);
});

it("shows organization and teams entries for org admins", () => {
	const entries = getVisibleSettings("orgAdmin", true);

	expect(entries.find((entry) => entry.id === "organizations")).toMatchObject({
		titleDefault: "Organization",
		href: "/settings/organizations",
		minimumTier: "orgAdmin",
	});
	expect(entries.find((entry) => entry.id === "teams")).toMatchObject({
		titleDefault: "Teams",
		href: "/settings/teams",
		minimumTier: "manager",
	});
});
```

Replace the existing test named `shows the scoped organization and teams entry for managers without exposing billing` with the first test above.

- [ ] **Step 2: Run the focused settings config test and verify it fails**

Run from `apps/webapp`:

```bash
pnpm vitest run src/components/settings/settings-config.test.ts
```

Expected: FAIL because `teams` is not in `SETTINGS_ENTRIES`, and managers can still see `organizations`.

- [ ] **Step 3: Update `SETTINGS_ENTRIES`**

In `apps/webapp/src/components/settings/settings-config.ts`, replace the current `organizations` entry with these two adjacent entries:

```ts
	{
		id: "organizations",
		titleKey: "settings.organizations.title",
		titleDefault: "Organization",
		descriptionKey: "settings.organizations.description",
		descriptionDefault: "Manage organization members, invitations, and details",
		href: "/settings/organizations",
		icon: "building",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "teams",
		titleKey: "settings.teams.title",
		titleDefault: "Teams",
		descriptionKey: "settings.teams.description",
		descriptionDefault: "Organize employees into teams and manage team assignments",
		href: "/settings/teams",
		icon: "users",
		minimumTier: "manager",
		group: "organization",
	},
```

- [ ] **Step 4: Run the focused settings config test and verify it passes**

Run from `apps/webapp`:

```bash
pnpm vitest run src/components/settings/settings-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the navigation split**

Run from the repo root:

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat: split teams settings entry"
```

Expected: commit succeeds. If unrelated changes exist in either file, inspect with `git diff -- <file>` and only stage the intended hunks using a non-interactive patch method.

### Task 2: Route Access Split

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Modify: `apps/webapp/src/lib/settings-access.ts`

- [ ] **Step 1: Write failing route access assertions**

In `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`, update the manager route test so it asserts the split explicitly:

```ts
expect(canResolvedTierAccessRoute(managerTier, "/settings/organizations")).toBe(false);
expect(canResolvedTierAccessRoute(managerTier, "/settings/teams")).toBe(true);
```

Replace the existing organization expectation in that test:

```ts
expect(canResolvedTierAccessRoute(managerTier, "/settings/organizations")).toBe(true);
```

Also rename the test from:

```ts
it("allows managers through the scoped organization and teams route only", () => {
```

to:

```ts
it("allows managers through teams but not organization management", () => {
```

Update the organization page responsibility test near the end of the file to this content:

```ts
it("keeps organization management org-admin-only and separate from teams", () => {
	const source = stripComments(
		readFileSync(join(SETTINGS_ROOT, "organizations/page.tsx"), "utf8"),
	);

	expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
	expect(source.includes('accessTier !== "orgAdmin"')).toBe(true);
	expect(source.includes("loadTeamSettingsPageData(")).toBe(false);
	expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
});
```

- [ ] **Step 2: Run the focused route access test and verify it fails**

Run from `apps/webapp`:

```bash
pnpm vitest run 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: FAIL because `/settings/organizations` is not yet listed in `ORG_ADMIN_SETTINGS_ROUTES`, and the organizations page still loads team data.

- [ ] **Step 3: Add organization route to org-admin-only settings routes**

In `apps/webapp/src/lib/settings-access.ts`, add `/settings/organizations` to the top of `ORG_ADMIN_SETTINGS_ROUTES`:

```ts
export const ORG_ADMIN_SETTINGS_ROUTES = [
	"/settings/organizations",
	"/settings/billing",
	"/settings/avv",
```

In the same route access test, update the expected exported route list to include the same first entry:

```ts
expect(ORG_ADMIN_SETTINGS_ROUTES).toEqual([
	"/settings/organizations",
	"/settings/billing",
	"/settings/avv",
```

- [ ] **Step 4: Run the focused route access test and verify the remaining failure**

Run from `apps/webapp`:

```bash
pnpm vitest run 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: FAIL only on the organization page responsibility test, because the page still includes `loadTeamSettingsPageData(`.

- [ ] **Step 5: Commit route access helper changes**

Run from the repo root:

```bash
git add apps/webapp/src/lib/settings-access.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "fix: make organization settings admin only"
```

Expected: commit succeeds if only these intended changes are staged.

### Task 3: Organization Page Simplification

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
- Modify: `apps/webapp/src/components/organization/organizations-page-client.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Simplify server page imports and access guard**

In `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`, remove this import:

```ts
import { loadTeamSettingsPageData } from "@/app/[locale]/(app)/settings/teams/team-settings-page-data";
```

Then replace the member access guard:

```ts
if (settingsRouteContext.accessTier === "member") {
	redirect("/settings");
}
```

with:

```ts
if (settingsRouteContext.accessTier !== "orgAdmin") {
	redirect("/settings");
}
```

- [ ] **Step 2: Remove teams data loading from the organizations page**

In the same file, replace the `Promise.all` destructuring block with this version:

```ts
const [organization, invitations, currentMember, members] = await Promise.all([
	db.query.organization.findFirst({
		where: eq(authSchema.organization.id, organizationId),
	}),
	db.query.invitation.findMany({
		where: and(
			eq(authSchema.invitation.organizationId, organizationId),
			eq(authSchema.invitation.status, "pending"),
		),
		with: {
			user: true,
		},
		orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
	}),
	db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	}),
	db
		.select({
			member: authSchema.member,
			user: authSchema.user,
			employee: employee,
		})
		.from(authSchema.member)
		.innerJoin(authSchema.user, eq(authSchema.member.userId, authSchema.user.id))
		.leftJoin(
			employee,
			and(eq(employee.userId, authSchema.user.id), eq(employee.organizationId, organizationId)),
		)
		.where(eq(authSchema.member.organizationId, organizationId)),
]);
```

Also add `employee` to the existing schema import:

```ts
import { employee } from "@/db/schema";
```

- [ ] **Step 3: Update `OrganizationsPageClient` props usage**

In the JSX returned by `organizations/page.tsx`, replace the props with:

```tsx
<OrganizationsPageClient
	organization={organization}
	members={members}
	invitations={invitations}
	currentMemberRole={currentMember.role as "owner" | "admin" | "member"}
	currentUserId={authContext.user.id}
	canCreateOrganizations={
		authContext.user.canCreateOrganizations || authContext.user.role === "admin"
	}
/>
```

- [ ] **Step 4: Remove teams props and tabs from the client component**

In `apps/webapp/src/components/organization/organizations-page-client.tsx`, remove these imports:

```ts
import { useState } from "react";
import type { ScopedTeam } from "@/app/[locale]/(app)/settings/teams/team-scope";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamsTab } from "./teams-tab";
```

Remove these props from `OrganizationsPageClientProps`:

```ts
teams: ScopedTeam[];
canAccessOrganizationAdminSurface: boolean;
canCreateTeams: boolean;
```

Replace the component body with:

```tsx
export function OrganizationsPageClient({
	organization,
	members,
	invitations,
	currentMemberRole,
	currentUserId,
	canCreateOrganizations,
}: OrganizationsPageClientProps) {
	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold mb-2">Organization</h1>
					<p className="text-muted-foreground">
						Manage your organization members, invitations, and details
					</p>
				</div>

				<OrganizationTab
					organization={organization}
					members={members}
					invitations={invitations}
					currentMemberRole={currentMemberRole}
					currentUserId={currentUserId}
					canCreateOrganizations={canCreateOrganizations}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Run the focused route access test and verify it passes**

Run from `apps/webapp`:

```bash
pnpm vitest run 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit organization page simplification**

Run from the repo root:

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx apps/webapp/src/components/organization/organizations-page-client.tsx apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "refactor: separate organization settings page"
```

Expected: commit succeeds if only these intended changes are staged.

### Task 4: Teams Refresh UX

**Files:**
- Modify: `apps/webapp/src/components/organization/teams-tab.tsx`

- [ ] **Step 1: Add router and refresh icon imports**

In `apps/webapp/src/components/organization/teams-tab.tsx`, replace the icon import:

```ts
import { IconPlus, IconUsers } from "@tabler/icons-react";
```

with:

```ts
import { IconPlus, IconRefresh, IconUsers } from "@tabler/icons-react";
```

Add this import with the other app imports:

```ts
import { useRouter } from "@/navigation";
```

Inside `TeamsTab`, after `const queryClient = useQueryClient();`, add:

```ts
const router = useRouter();
```

- [ ] **Step 2: Fix prop-to-state sync with `useEffect`**

Replace this render-time state update:

```ts
// Sync with props when they change
if (initialTeams !== teams && initialTeams.length !== teams.length) {
	setTeams(initialTeams);
}
```

with a React effect. First update the React import:

```ts
import { useEffect, useState } from "react";
```

Then add the effect after selected team state:

```ts
useEffect(() => {
	setTeams(initialTeams);
}, [initialTeams]);
```

- [ ] **Step 3: Add a single refresh helper**

Below `getTeamEmployees`, add:

```ts
const refreshTeams = () => {
	queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(organizationId) });
	router.refresh();
};
```

- [ ] **Step 4: Refresh after create and edit success**

In `handleTeamCreated`, replace the final invalidate call:

```ts
queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(organizationId) });
```

with:

```ts
refreshTeams();
```

In `handleTeamUpdated`, replace the final invalidate call with the same:

```ts
refreshTeams();
```

- [ ] **Step 5: Refresh after successful delete and rollback unsuccessful server results**

Replace the `deleteMutation` `onSuccess` with:

```ts
onSuccess: (result, _teamId, context) => {
	if (result.success) {
		toast.success("Team deleted successfully");
		refreshTeams();
		return;
	}

	if (context?.previousTeams) {
		setTeams(context.previousTeams);
	}
	toast.error(result.error || "Failed to delete team");
},
```

Keep the existing `onError` rollback.

- [ ] **Step 6: Add the manual Refresh button**

In the card header button area, replace this block:

```tsx
{canCreateTeams && (
	<Button onClick={() => setCreateDialogOpen(true)}>
		<IconPlus className="mr-2 h-4 w-4" />
		Create Team
	</Button>
)}
```

with:

```tsx
<div className="flex items-center gap-2">
	<Button type="button" variant="outline" onClick={refreshTeams}>
		<IconRefresh className="mr-2 h-4 w-4" />
		Refresh
	</Button>
	{canCreateTeams && (
		<Button onClick={() => setCreateDialogOpen(true)}>
			<IconPlus className="mr-2 h-4 w-4" />
			Create Team
		</Button>
	)}
</div>
```

- [ ] **Step 7: Run TypeScript or lint for the touched component**

Run from `apps/webapp`:

```bash
pnpm build
```

Expected: PASS, or FAIL only for pre-existing unrelated errors. If it fails on `teams-tab.tsx`, fix the import, hook, or type error before continuing.

- [ ] **Step 8: Commit teams refresh UX**

Run from the repo root:

```bash
git add apps/webapp/src/components/organization/teams-tab.tsx
git commit -m "fix: refresh teams settings after changes"
```

Expected: commit succeeds if only this intended change is staged.

### Task 5: Final Verification

**Files:**
- Verify: all files modified in Tasks 1-4

- [ ] **Step 1: Run targeted tests**

Run from `apps/webapp`:

```bash
pnpm vitest run src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run from `apps/webapp`:

```bash
pnpm build
```

Expected: PASS, or document any failure with the exact failing file and whether it is unrelated to this change.

- [ ] **Step 3: Inspect final diff**

Run from the repo root:

```bash
git diff --stat HEAD
git diff -- apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/lib/settings-access.ts apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx apps/webapp/src/components/organization/organizations-page-client.tsx apps/webapp/src/components/organization/teams-tab.tsx apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
```

Expected: only the intended implementation changes appear. Unrelated existing worktree changes may still appear in `git status`; do not modify or revert them.

- [ ] **Step 4: Commit any remaining verification fixes**

If Task 5 required fixes, run from the repo root:

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/lib/settings-access.ts apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx apps/webapp/src/components/organization/organizations-page-client.tsx apps/webapp/src/components/organization/teams-tab.tsx apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "test: verify settings teams split"
```

Expected: commit succeeds only if verification fixes were needed. Do not create an empty commit.

## Self-Review Notes

- Spec coverage: the plan covers the settings entry split, org-admin-only organization access, manager-visible teams access, team mutation refresh, manual refresh, and targeted tests.
- Placeholder scan: no placeholder work remains; each task names exact files, commands, and expected outcomes.
- Type consistency: the plan uses existing `SettingsAccessTier`, `ScopedTeam`, `queryKeys.teams.list`, `useRouter`, and `router.refresh()` patterns already present in the app.
