# Employees Invite And Member Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move member, invitation, pending-member, and invite-code management from `/settings/organizations` into a role-aware tabbed `/settings/employees` people-management surface.

**Architecture:** Keep data ownership and server actions unchanged. Extract the existing employee directory UI into a focused child component, then compose it with org-admin-only people tabs that reuse the existing organization member/invite components. Simplify organization settings so it only renders organization configuration cards.

**Tech Stack:** Next.js App Router, React client components, TanStack Query/Table, Drizzle ORM, Better Auth organization/member/invitation schema, Tolgee translations, Vitest, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/components/settings/settings-config.ts`
  - Responsibility: settings nav title/description metadata.
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
  - Responsibility: settings visibility and copy regression tests.
- Modify: `apps/webapp/src/components/organization/organizations-page-client.tsx`
  - Responsibility: organization settings page shell and props after member/invite removal.
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`
  - Responsibility: organization configuration cards only.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
  - Responsibility: load only organization configuration data.
- Modify: `apps/webapp/src/components/organization/members-table.test.tsx`
  - Responsibility: source-level regression that organization page no longer composes member/invite UI.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
  - Responsibility: load active organization member/invitation context for org-admin tabs and pass it to the client.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
  - Responsibility: split employee directory into a reusable child and render org-admin people tabs.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`
  - Responsibility: role-aware tab rendering and removed redirect button regression tests.

Existing server actions stay in:

- `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/organizations/invite-code-actions.ts`

Do not edit `apps/webapp/src/db/auth-schema.ts`.

---

### Task 1: Update Settings Copy

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`

- [ ] **Step 1: Write the failing settings copy test**

Add this test after `shows organization and teams entries for org admins` in `apps/webapp/src/components/settings/settings-config.test.ts`:

```ts
	it("uses people-management copy for employees and configuration copy for organization", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		const organizationEntry = entries.find((entry) => entry.id === "organizations");
		const employeesEntry = entries.find((entry) => entry.id === "employees");

		expect(organizationEntry).toMatchObject({
			descriptionDefault: "Manage organization details and configuration",
		});
		expect(organizationEntry?.descriptionDefault).not.toMatch(/member|invitation|invite/i);
		expect(employeesEntry).toMatchObject({
			descriptionDefault: "Manage employees, members, and invites",
		});
	});
```

- [ ] **Step 2: Run the failing settings copy test**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts
```

Expected: FAIL because the organization entry still says `Manage organization members, invitations, and details` and the employees entry still says `Manage employee profiles, roles, and manager assignments`.

- [ ] **Step 3: Update settings config copy**

In `apps/webapp/src/components/settings/settings-config.ts`, change the two entries to:

```ts
	{
		id: "organizations",
		titleKey: "settings.organizations.title",
		titleDefault: "Organization",
		descriptionKey: "settings.organizations.description",
		descriptionDefault: "Manage organization details and configuration",
		href: "/settings/organizations",
		icon: "building",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "employees",
		titleKey: "settings.employees.title",
		titleDefault: "Employees",
		descriptionKey: "settings.employees.description",
		descriptionDefault: "Manage employees, members, and invites",
		href: "/settings/employees",
		icon: "users",
		minimumTier: "manager",
		group: "organization",
	},
```

- [ ] **Step 4: Run the settings copy test again**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit settings copy**

Run:

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "💬 copy(settings): clarify people management entries"
```

---

### Task 2: Remove People Management From Organization Page

**Files:**
- Modify: `apps/webapp/src/components/organization/members-table.test.tsx`
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`
- Modify: `apps/webapp/src/components/organization/organizations-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`

- [ ] **Step 1: Write the failing source regression test**

In `apps/webapp/src/components/organization/members-table.test.tsx`, add this test inside the existing `describe("MembersTable invitation target teams", () => {` block before the closing `});`:

```ts
	it("keeps people-management components off the organization settings page", () => {
		const pageSource = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/settings/organizations/page.tsx"),
			"utf8",
		);
		const tabSource = readFileSync(
			join(process.cwd(), "src/components/organization/organization-tab.tsx"),
			"utf8",
		);
		const clientSource = readFileSync(
			join(process.cwd(), "src/components/organization/organizations-page-client.tsx"),
			"utf8",
		);

		expect(pageSource).not.toContain("type InvitationWithInviter");
		expect(pageSource).not.toContain("type MemberWithUserAndEmployee");
		expect(pageSource).not.toContain("db.query.invitation.findMany");
		expect(pageSource).not.toContain("db.query.member.findFirst");
		expect(pageSource).not.toContain(".from(authSchema.member)");
		expect(tabSource).not.toContain("InviteCodeManagement");
		expect(tabSource).not.toContain("PendingMembersCard");
		expect(tabSource).not.toContain("MembersTable");
		expect(tabSource).not.toContain("InviteMemberDialog");
		expect(clientSource).not.toContain("members:");
		expect(clientSource).not.toContain("invitations:");
	});
```

- [ ] **Step 2: Run the failing organization-page test**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/members-table.test.tsx
```

Expected: FAIL because organization page and tab still load/render member and invitation components.

- [ ] **Step 3: Simplify `OrganizationTab` props and imports**

In `apps/webapp/src/components/organization/organization-tab.tsx`, replace imports at the top with:

```tsx
"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type * as authSchema from "@/db/auth-schema";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { OrganizationDangerZoneCard } from "./organization-danger-zone-card";
import { OrganizationDetailsCard } from "./organization-details-card";
import { OrganizationFeaturesCard } from "./organization-features-card";
import { OrganizationLanguageCard } from "./organization-language-card";
import { OrganizationTimezoneCard } from "./organization-timezone-card";
```

Replace the props interface with:

```tsx
interface OrganizationTabProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	canCreateOrganizations: boolean;
}
```

Replace the function signature and state setup with:

```tsx
export function OrganizationTab({
	organization,
	memberCount,
	currentMemberRole,
	defaultNotificationLanguage,
	canCreateOrganizations,
}: OrganizationTabProps) {
	const { t } = useTranslate();
	const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
```

Remove the returned JSX blocks that render these components:

- `InviteCodeManagement`
- `PendingMembersCard`
- the `Card` whose `CardTitle` uses `organization.membersInvitations.title`
- `InviteMemberDialog`

In the `OrganizationDetailsCard`, replace `memberCount={members.length}` with:

```tsx
memberCount={memberCount}
```

- [ ] **Step 4: Simplify `OrganizationsPageClient` props**

In `apps/webapp/src/components/organization/organizations-page-client.tsx`, remove these imports:

```tsx
import type { employee } from "@/db/schema";
```

Delete the exported `MemberWithUserAndEmployee` interface and `InvitationWithInviter` type from `organizations-page-client.tsx`; Task 3 reintroduces those shapes beside the employees page because that page becomes the consumer.

Replace `OrganizationsPageClientProps` with:

```tsx
interface OrganizationsPageClientProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	canCreateOrganizations: boolean;
}
```

Replace the description fallback with:

```tsx
	const organizationDescription = t(
		"settings.organizations.description",
		"Manage organization details and configuration",
	);
```

Render `OrganizationTab` with:

```tsx
				<OrganizationTab
					organization={organization}
					memberCount={memberCount}
					currentMemberRole={currentMemberRole}
					defaultNotificationLanguage={defaultNotificationLanguage}
					canCreateOrganizations={canCreateOrganizations}
				/>
```

- [ ] **Step 5: Simplify organization page data loading**

In `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`, change imports to:

```tsx
import { and, eq, count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { organizationNotificationSettings } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { getTranslate } from "@/tolgee/server";
```

Replace the `Promise.all` block that loads organization/invitations/currentMember/members/notification settings with:

```tsx
	const [organization, currentMember, memberCountRows, organizationNotificationSettingsRecord] =
		await Promise.all([
			db.query.organization.findFirst({
				where: eq(authSchema.organization.id, organizationId),
			}),
			db.query.member.findFirst({
				where: and(
					eq(authSchema.member.userId, authContext.user.id),
					eq(authSchema.member.organizationId, organizationId),
				),
			}),
			db
				.select({ value: count() })
				.from(authSchema.member)
				.where(eq(authSchema.member.organizationId, organizationId)),
			db.query.organizationNotificationSettings.findFirst({
				where: eq(organizationNotificationSettings.organizationId, organizationId),
				columns: { defaultLanguage: true },
			}),
		]);
```

Remove the `targetTeamIds`, `targetTeams`, `targetTeamsById`, `typedInvitations`, and `typedMembers` code.

Render the client with:

```tsx
	return (
		<OrganizationsPageClient
			organization={organization}
			memberCount={memberCountRows[0]?.value ?? 0}
			currentMemberRole={currentMember.role as "owner" | "admin" | "member"}
			defaultNotificationLanguage={organizationNotificationSettingsRecord?.defaultLanguage ?? "en"}
			canCreateOrganizations={canCreateOrganizationsForDeployment(
				authContext.user.canCreateOrganizations || authContext.user.role === "admin",
			)}
		/>
	);
```

- [ ] **Step 6: Run organization-page tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/members-table.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit organization-page cleanup**

Run:

```bash
git add apps/webapp/src/components/organization/members-table.test.tsx apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organizations-page-client.tsx 'apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx'
git commit -m "♻️ refactor(settings): keep organization page configuration-only"
```

---

### Task 3: Load People Tab Data On Employees Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`

- [ ] **Step 1: Add temporary prop support to the employee client**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`, add these imports near the existing imports:

```tsx
import type * as authSchema from "@/db/auth-schema";
import type { employee } from "@/db/schema";
```

Add these exported types above `EmployeesPageClient`:

```tsx
export interface MemberWithUserAndEmployee {
	member: typeof authSchema.member.$inferSelect;
	user: typeof authSchema.user.$inferSelect;
	employee: typeof employee.$inferSelect | null;
	teamMemberships?: Array<{ teamId: string }>;
}

export type InvitationWithInviter = typeof authSchema.invitation.$inferSelect & {
	user: typeof authSchema.user.$inferSelect;
	targetTeam?: { id: string; name: string } | null;
};

export interface EmployeesPagePeopleProps {
	organizationName: string;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
}
```

Change the `EmployeesPageClient` props type to:

```tsx
export function EmployeesPageClient(props: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	people?: EmployeesPagePeopleProps;
}) {
```

Do not render `people` yet in this task.

- [ ] **Step 2: Update employees page server loader**

Replace `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx` with:

```tsx
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { EmployeesPageClient, type InvitationWithInviter, type MemberWithUserAndEmployee } from "./employees-page-client";

async function loadPeopleManagementData(input: {
	organizationId: string;
	currentUserId: string;
}) {
	const [organization, currentMember, members, invitations] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, input.organizationId),
			columns: { name: true },
		}),
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, input.currentUserId),
				eq(authSchema.member.organizationId, input.organizationId),
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
				and(eq(employee.userId, authSchema.user.id), eq(employee.organizationId, input.organizationId)),
			)
			.where(eq(authSchema.member.organizationId, input.organizationId)),
		db.query.invitation.findMany({
			where: and(
				eq(authSchema.invitation.organizationId, input.organizationId),
				eq(authSchema.invitation.status, "pending"),
			),
			with: {
				user: true,
			},
			orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
		}),
	]);

	if (!organization || !currentMember) {
		redirect("/settings");
	}

	const targetTeamIds = Array.from(
		new Set(invitations.map((invitation) => invitation.targetTeamId).filter((id): id is string => !!id)),
	);
	const targetTeams = targetTeamIds.length
		? await db
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(and(eq(team.organizationId, input.organizationId), inArray(team.id, targetTeamIds)))
		: [];
	const targetTeamsById = new Map(targetTeams.map((team) => [team.id, { id: team.id, name: team.name }]));

	return {
		organizationName: organization.name,
		members: members as unknown as MemberWithUserAndEmployee[],
		invitations: invitations.map((invitation) => ({
			...invitation,
			targetTeam: invitation.targetTeamId ? (targetTeamsById.get(invitation.targetTeamId) ?? null) : null,
		})) as unknown as InvitationWithInviter[],
		currentMemberRole: currentMember.role as "owner" | "admin" | "member",
		currentUserId: input.currentUserId,
	};
}

export default async function EmployeesPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const people =
		settingsRouteContext.accessTier === "orgAdmin"
			? await loadPeopleManagementData({
					organizationId,
					currentUserId: settingsRouteContext.authContext.user.id,
				})
			: undefined;

	return (
		<EmployeesPageClient
			accessTier={settingsRouteContext.accessTier}
			organizationId={organizationId}
			people={people}
		/>
	);
}
```

- [ ] **Step 3: Run TypeScript-adjacent targeted tests**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/settings/__tests__/settings-route-access.test.ts
```

Expected: PASS. This does not fully type-check the new props but verifies route access did not regress.

- [ ] **Step 4: Commit employee data loader**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx'
git commit -m "✨ feat(settings): load people data for employees page"
```

---

### Task 4: Add Tabbed People Management UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`

- [ ] **Step 1: Write source-level UI regression tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	join(process.cwd(), "src/app/[locale]/(app)/settings/employees/employees-page-client.tsx"),
	"utf8",
);

describe("EmployeesPageClient people-management tabs", () => {
	it("keeps the employee directory as a focused child component", () => {
		expect(source).toContain("function EmployeeDirectoryTab");
		expect(source).toContain("<EmployeeDirectoryTab");
	});

	it("renders org-admin people tabs on the employees page", () => {
		expect(source).toContain('Tabs defaultValue="employees"');
		expect(source).toContain('TabsTrigger value="employees"');
		expect(source).toContain('TabsTrigger value="members"');
		expect(source).toContain('TabsTrigger value="invitations"');
		expect(source).toContain('TabsTrigger value="invite-codes"');
		expect(source).toContain("<MembersTable");
		expect(source).toContain("<PendingMembersCard");
		expect(source).toContain("<InviteCodeManagement");
		expect(source).toContain("<InviteMemberDialog");
	});

	it("does not send invite actions back to organization settings", () => {
		expect(source).not.toContain('href="/settings/organizations"');
		expect(source).not.toContain("href='/settings/organizations'");
	});
});
```

- [ ] **Step 2: Run failing employee UI tests**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/settings/employees/employees-page-client.test.tsx
```

Expected: FAIL because the tab components and child component do not exist yet.

- [ ] **Step 3: Add imports for tabs and moved components**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`, update imports:

```tsx
import {
	IconChevronLeft,
	IconChevronRight,
	IconPlus,
	IconRefresh,
	IconSearch,
	IconUser,
} from "@tabler/icons-react";
import {
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
} from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useTransition } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { InviteCodeManagement } from "@/components/organization/invite-code-management";
import { InviteMemberDialog } from "@/components/organization/invite-member-dialog";
import { MembersTable } from "@/components/organization/members-table";
import { PendingMembersCard } from "@/components/organization/pending-members-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompilerSafeReactTable } from "@/components/use-compiler-safe-react-table";
import type * as authSchema from "@/db/auth-schema";
import type { employee } from "@/db/schema";
import { queryKeys, useEmployeeClockStatuses } from "@/lib/query";
import { useEmployees } from "@/lib/query/use-employees";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { columns } from "./columns";
import type { EmployeeDirectoryRow } from "./employee-action-types";
```

Remove the unused import:

```tsx
import { Link } from "@/navigation";
```

- [ ] **Step 4: Extract the employee directory child component**

Replace the current `EmployeesPageClient` function body with two components. First, add this component below the exported types:

```tsx
function EmployeeDirectoryTab(props: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	showHeader: boolean;
}) {
	const { t } = useTranslate();
	const {
		employees,
		total,
		isLoading,
		isFetching,
		hasEmployee,
		role,
		status,
		setSearch,
		setRole,
		setStatus,
		pagination,
		setPagination,
		pageCount,
		refresh,
	} = useEmployees({ accessTier: props.accessTier, organizationId: props.organizationId });
	const presence = useEmployeeClockStatuses(
		employees.map((employee) => employee.id),
		{ polling: true },
	);
	const employeesWithPresence = employees.map((employee) => ({
		...employee,
		clockStatus: presence.getStatus(employee.id),
	}));

	const [sorting, setSorting] = useState<SortingState>([]);
	const [searchInput, setSearchInput] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(searchInput);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput, setSearch]);

	const table = useCompilerSafeReactTable<EmployeeDirectoryRow>({
		data: employeesWithPresence,
		columns,
		state: { sorting, pagination },
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		manualPagination: true,
		pageCount,
		manualFiltering: true,
	});

	if (!hasEmployee && !isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.employees.directory.noEmployeeFeature", "manage employees")} />
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4">
			{props.showHeader && (
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("settings.employees.title", "Employees")}
						</h1>
						<p className="text-sm text-muted-foreground">
							{t("settings.employees.description", "Manage employees, members, and invites")}
						</p>
					</div>
					<Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching}>
						<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("settings.employees.directory.refresh", "Refresh")}</span>
					</Button>
				</div>
			)}

			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>{t("settings.employees.directory.title", "Employee Directory")}</CardTitle>
							<CardDescription>
								{t("settings.employees.directory.countFound", "{count} employee(s) found", {
									count: total,
								})}
							</CardDescription>
						</div>
						{!props.showHeader && (
							<Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching}>
								<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
								<span className="sr-only">{t("settings.employees.directory.refresh", "Refresh")}</span>
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="mb-4 flex flex-col gap-4 sm:flex-row">
						<div className="relative flex-1">
							<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								aria-label={t("settings.employees.directory.searchLabel", "Search employees")}
								placeholder={t("settings.employees.directory.searchPlaceholder", "Search by name, email, or position...")}
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								className="pl-9"
							/>
						</div>
						<Select value={role} onValueChange={setRole}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder={t("settings.employees.directory.roleFilter", "Filter by role")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t("settings.employees.directory.roles.all", "All Roles")}</SelectItem>
								<SelectItem value="admin">{t("settings.employees.directory.roles.admin", "Admin")}</SelectItem>
								<SelectItem value="manager">{t("settings.employees.directory.roles.manager", "Manager")}</SelectItem>
								<SelectItem value="employee">{t("settings.employees.directory.roles.employee", "Employee")}</SelectItem>
							</SelectContent>
						</Select>
						<Select value={status} onValueChange={setStatus}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder={t("settings.employees.directory.statusFilter", "Filter by status")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t("settings.employees.directory.statuses.all", "All Status")}</SelectItem>
								<SelectItem value="active">{t("settings.employees.directory.statuses.active", "Active")}</SelectItem>
								<SelectItem value="inactive">{t("settings.employees.directory.statuses.inactive", "Inactive")}</SelectItem>
								<SelectItem value="draft">{t("settings.employees.directory.statuses.draft", "Draft")}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<p className="text-sm text-muted-foreground">{t("settings.employees.directory.loading", "Loading employees...")}</p>
						</div>
					) : (
						<>
							<div className="overflow-x-auto rounded-md border">
								<Table>
									<TableHeader>
										{table.getHeaderGroups().map((headerGroup) => (
											<TableRow key={headerGroup.id}>
												{headerGroup.headers.map((header) => (
													<TableHead key={header.id}>
														{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
													</TableHead>
												))}
											</TableRow>
										))}
									</TableHeader>
									<TableBody>
										{table.getRowModel().rows.length ? (
											table.getRowModel().rows.map((row) => (
												<TableRow key={row.id}>
													{row.getVisibleCells().map((cell) => (
														<TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
													))}
												</TableRow>
											))
										) : (
											<TableRow>
												<TableCell colSpan={columns.length} className="h-24 text-center">
													<div className="flex flex-col items-center justify-center">
														<IconUser className="mb-2 size-8 text-muted-foreground" />
														<p className="text-sm text-muted-foreground">{t("settings.employees.directory.emptyState", "No employees found")}</p>
													</div>
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
							</div>

							{pageCount > 1 && (
								<div className="mt-4 flex items-center justify-between">
									<div className="text-sm text-muted-foreground">
										{t("settings.employees.directory.pagination.pageOf", "Page {page} of {total}", {
											page: pagination.pageIndex + 1,
											total: pageCount,
										})}
									</div>
									<div className="flex items-center gap-2">
										<Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
											<IconChevronLeft className="size-4" />
											{t("common.previous", "Previous")}
										</Button>
										<Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
											{t("common.next", "Next")}
											<IconChevronRight className="size-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 5: Add the people tabs parent component**

Below `EmployeeDirectoryTab`, add this exported `EmployeesPageClient`:

```tsx
export function EmployeesPageClient(props: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	people?: EmployeesPagePeopleProps;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
	const [isRefreshingPeople, startPeopleRefresh] = useTransition();

	const shouldShowPeopleTabs = props.accessTier === "orgAdmin" && props.people;

	if (!shouldShowPeopleTabs) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<EmployeeDirectoryTab
					accessTier={props.accessTier}
					organizationId={props.organizationId}
					showHeader
				/>
			</div>
		);
	}

	const handlePeopleRefresh = () => {
		startPeopleRefresh(() => {
			queryClient.invalidateQueries({ queryKey: queryKeys.members.list(props.organizationId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(props.organizationId) });
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.employees.title", "Employees")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("settings.employees.description", "Manage employees, members, and invites")}
					</p>
				</div>
			</div>

			<Tabs defaultValue="employees" className="space-y-4">
				<TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
					<TabsTrigger value="employees">{t("settings.employees.tabs.employees", "Employees")}</TabsTrigger>
					<TabsTrigger value="members">{t("settings.employees.tabs.members", "Members")}</TabsTrigger>
					<TabsTrigger value="invitations">{t("settings.employees.tabs.invitations", "Invitations")}</TabsTrigger>
					<TabsTrigger value="invite-codes">{t("settings.employees.tabs.inviteCodes", "Invite Codes")}</TabsTrigger>
				</TabsList>

				<TabsContent value="employees" className="space-y-4">
					<EmployeeDirectoryTab
						accessTier={props.accessTier}
						organizationId={props.organizationId}
						showHeader={false}
					/>
				</TabsContent>

				<TabsContent value="members" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>{t("settings.employees.members.title", "Members")}</CardTitle>
							<CardDescription>
								{t("settings.employees.members.description", "Manage accepted workspace members and their access.")}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<MembersTable
								organizationId={props.organizationId}
								members={props.people.members}
								invitations={[]}
								currentMemberRole={props.people.currentMemberRole}
								currentUserId={props.people.currentUserId}
								onRefresh={handlePeopleRefresh}
								isRefreshing={isRefreshingPeople}
							/>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="invitations" className="space-y-4">
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2 className="text-lg font-semibold">{t("settings.employees.invitations.title", "Invitations")}</h2>
							<p className="text-sm text-muted-foreground">
								{t("settings.employees.invitations.description", "Invite people and track pending access.")}
							</p>
						</div>
						<Button onClick={() => setInviteDialogOpen(true)} className="shrink-0 px-2 sm:px-4">
							<IconPlus aria-hidden="true" className="size-4 sm:mr-2" />
							<span className="sr-only sm:not-sr-only">{t("organization.invite.member", "Invite Member")}</span>
						</Button>
					</div>
					<MembersTable
						organizationId={props.organizationId}
						members={[]}
						invitations={props.people.invitations}
						currentMemberRole={props.people.currentMemberRole}
						currentUserId={props.people.currentUserId}
						onRefresh={handlePeopleRefresh}
						isRefreshing={isRefreshingPeople}
					/>
					<PendingMembersCard organizationId={props.organizationId} currentMemberRole={props.people.currentMemberRole} />
				</TabsContent>

				<TabsContent value="invite-codes" className="space-y-4">
					<InviteCodeManagement organizationId={props.organizationId} currentMemberRole={props.people.currentMemberRole} />
				</TabsContent>
			</Tabs>

			<InviteMemberDialog
				organizationId={props.organizationId}
				organizationName={props.people.organizationName}
				currentMemberRole={props.people.currentMemberRole}
				open={inviteDialogOpen}
				onOpenChange={setInviteDialogOpen}
			/>
		</div>
	);
}
```

- [ ] **Step 6: Run employee UI tests**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/settings/employees/employees-page-client.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run focused related component tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/members-table.test.tsx src/components/organization/invite-code-management.test.tsx src/components/organization/invite-member-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit people tabs UI**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx'
git commit -m "✨ feat(settings): add employee people management tabs"
```

---

### Task 5: Final Route And Regression Checks

**Files:**
- Modify only if tests expose a real regression.

- [ ] **Step 1: Run settings and moved-surface tests together**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts src/app/[locale]/\(app\)/settings/__tests__/settings-route-access.test.ts src/components/organization/members-table.test.tsx src/components/organization/invite-code-management.test.tsx src/components/organization/invite-member-dialog.test.tsx src/app/[locale]/\(app\)/settings/employees/employees-page-client.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full webapp test suite if targeted checks pass**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated pre-existing failures appear, record the failing test names and confirm the targeted tests above still pass.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm --dir apps/webapp build
```

Expected: PASS. This is the best check for type errors introduced by the page/client prop changes.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organizations-page-client.tsx 'apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx'
```

Expected: only intended files are modified. Unrelated pre-existing worktree changes must remain untouched.

- [ ] **Step 5: Commit final fixes if any were needed**

If Step 1, Step 2, or Step 3 required fixes, stage only the files changed for those fixes. For this plan, that means one or more of these paths:

- `apps/webapp/src/components/settings/settings-config.ts`
- `apps/webapp/src/components/settings/settings-config.test.ts`
- `apps/webapp/src/components/organization/members-table.test.tsx`
- `apps/webapp/src/components/organization/organization-tab.tsx`
- `apps/webapp/src/components/organization/organizations-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`

Then commit:

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/components/organization/members-table.test.tsx apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organizations-page-client.tsx 'apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx'
git commit -m "✅ test(settings): cover employee people tabs"
```

If no fixes were needed after Task 4, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Current employee list remains default: Task 4 extracts `EmployeeDirectoryTab` and uses `Tabs defaultValue="employees"`.
- All invite surfaces move: Task 2 removes `InviteCodeManagement`, `PendingMembersCard`, `MembersTable`, and `InviteMemberDialog` from organization settings; Task 4 composes them on employee tabs.
- Organization settings becomes configuration-only: Task 2 simplifies page data and organization client props.
- Permissions preserved: Task 3 only loads people data for `accessTier === "orgAdmin"`; Task 4 shows managers only the directory.
- Data model unchanged: no migration tasks and no auth-schema edits.

Placeholder scan: no unspecified implementation steps are intentionally left in task instructions.

Type consistency: `MemberWithUserAndEmployee`, `InvitationWithInviter`, and `EmployeesPagePeopleProps` are introduced in Task 3 and reused in later tasks with the same names.
