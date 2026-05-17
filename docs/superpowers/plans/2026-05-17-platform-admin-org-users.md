# Platform Admin Organization Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show platform admins which organizations each user belongs to, and let admins open a filtered users list from an organization.

**Architecture:** Extend `PlatformAdminService.listUsers` with an optional `organizationId` filter and membership payload. Reuse the existing `/platform-admin/users` page for organization member views by preserving the filter in the URL and query key. Add links from `/platform-admin/organizations` into the filtered users page.

**Tech Stack:** Next.js App Router client pages, React, TanStack Query, Effect services, Drizzle ORM, Vitest, Testing Library, shadcn-style UI components.

---

## File Structure

- Modify: `apps/webapp/src/lib/effect/services/platform-admin.service.ts`
  - Add `PlatformUserOrganization` type.
  - Add `organizationId` to `PlatformUserFilters`.
  - Import the generated `member` table.
  - Filter users by membership when `organizationId` is present.
  - Fetch memberships for the paginated users and attach them to each returned user.
- Modify: `apps/webapp/src/lib/effect/services/platform-admin.service.test.ts`
  - Add source guardrail tests that verify membership joins use `member` and still avoid selecting profile names/images.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`
  - Parse `organizationId` from URL state.
  - Pass it to `listUsersAction`.
  - Preserve it when search/status filters change.
  - Render an `Organizations` table column with membership role labels.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`
  - Add membership data to the mocked user.
  - Assert organization name and role render.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx`
  - Import `Link` from `@/navigation`.
  - Link organization name and member count to `/platform-admin/users?organizationId=<id>`.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`
  - Mock `Link`.
  - Assert links target the filtered users page.

Commits are intentionally not included as executable steps because this environment requires explicit user approval before committing.

---

### Task 1: Extend Platform User Data With Memberships

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/platform-admin.service.ts`
- Test: `apps/webapp/src/lib/effect/services/platform-admin.service.test.ts`

- [ ] **Step 1: Write failing service guardrail tests**

Add these tests inside `describe("PlatformAdminService listUsers privacy guardrails", () => { ... })` in `apps/webapp/src/lib/effect/services/platform-admin.service.test.ts`:

```ts
it("selects organization memberships without selecting organization private fields", () => {
	const listUsersSource = getListUsersSource();

	expect(listUsersSource).toContain("member.userId");
	expect(listUsersSource).toContain("member.organizationId");
	expect(listUsersSource).toContain("role: member.role");
	expect(listUsersSource).toContain("status: member.status");
	expect(listUsersSource).toContain("name: organization.name");
	expect(listUsersSource).toContain("slug: organization.slug");
	expect(listUsersSource).not.toContain("logo: organization.logo");
});

it("supports filtering users by organization membership", () => {
	const listUsersSource = getListUsersSource();

	expect(listUsersSource).toContain("organizationId");
	expect(listUsersSource).toContain("inArray(user.id");
	expect(listUsersSource).toContain("eq(member.organizationId, organizationId)");
});
```

- [ ] **Step 2: Run the focused service tests and verify failure**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/platform-admin.service.test.ts
```

Expected: FAIL because `listUsers` does not yet import/use `member`, does not expose `organizationId`, and does not attach memberships.

- [ ] **Step 3: Update service types and imports**

In `apps/webapp/src/lib/effect/services/platform-admin.service.ts`, change the auth schema import:

```ts
import { user, session, organization, member } from "@/db/auth-schema";
```

Replace the `PlatformUser` and `PlatformUserFilters` definitions with:

```ts
export interface PlatformUserOrganization {
	id: string;
	name: string;
	slug: string;
	role: string;
	status: string | null;
}

export interface PlatformUser {
	id: string;
	email: string;
	emailVerified: boolean;
	role: string | null;
	banned: boolean | null;
	banReason: string | null;
	banExpires: Date | null;
	createdAt: Date;
	organizations: PlatformUserOrganization[];
}

export interface PlatformUserFilters {
	search?: string;
	status?: "all" | "active" | "banned";
	organizationId?: string;
}
```

- [ ] **Step 4: Implement membership filtering and enrichment**

Inside `listUsers`, replace the first filter destructure with:

```ts
const { search, status, organizationId } = filters;
```

After the status filter block and before `const whereClause = ...`, add:

```ts
if (organizationId) {
	const membershipsForOrganization = await db
		.select({ userId: member.userId })
		.from(member)
		.where(eq(member.organizationId, organizationId));

	const userIds = membershipsForOrganization.map((membership) => membership.userId);

	if (userIds.length === 0) {
		return {
			data: [],
			total: 0,
			page,
			pageSize,
			totalPages: 0,
		};
	}

	conditions.push(inArray(user.id, userIds));
}
```

After the paginated `users` query and before the `return`, add:

```ts
const userIds = users.map((platformUser) => platformUser.id);
const memberships =
	userIds.length > 0
		? await db
				.select({
					userId: member.userId,
					id: organization.id,
					name: organization.name,
					slug: organization.slug,
					role: member.role,
					status: member.status,
				})
				.from(member)
				.innerJoin(organization, eq(member.organizationId, organization.id))
				.where(
					organizationId
						? and(inArray(member.userId, userIds), eq(member.organizationId, organizationId))
						: inArray(member.userId, userIds),
				)
		: [];

const membershipsByUserId = new Map<string, PlatformUserOrganization[]>();

for (const membership of memberships) {
	const userMemberships = membershipsByUserId.get(membership.userId) ?? [];
	userMemberships.push({
		id: membership.id,
		name: membership.name,
		slug: membership.slug,
		role: membership.role,
		status: membership.status,
	});
	membershipsByUserId.set(membership.userId, userMemberships);
}

const usersWithOrganizations: PlatformUser[] = users.map((platformUser) => ({
	...platformUser,
	organizations: membershipsByUserId.get(platformUser.id) ?? [],
}));
```

Then change the returned `data` field from:

```ts
data: users,
```

to:

```ts
data: usersWithOrganizations,
```

- [ ] **Step 5: Run focused service tests and verify pass**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/platform-admin.service.test.ts
```

Expected: PASS.

---

### Task 2: Show Organization Memberships On Users Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`
- Test: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`

- [ ] **Step 1: Write failing users page test**

In the mocked user object inside `beforeEach` in `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`, add:

```ts
organizations: [
	{
		id: "org-acme",
		name: "Acme Corp",
		slug: "acme-corp",
		role: "owner",
		status: "approved",
	},
],
```

Add this test after the existing redaction test:

```ts
it("shows organization memberships and roles for each user", () => {
	render(<UsersPage />);

	expect(screen.getByText("Organizations")).toBeTruthy();
	expect(screen.getByText("Acme Corp")).toBeTruthy();
	expect(screen.getByText("owner")).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused users page test and verify failure**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/users/page.test.tsx'
```

Expected: FAIL because the users table has no `Organizations` column.

- [ ] **Step 3: Parse and preserve `organizationId` in users page filters**

In `getInitialFilters`, change the return type to:

```ts
function getInitialFilters(): { search: string; status: UserStatusFilter; organizationId: string } {
```

In the server-side branch, return:

```ts
return {
	search: "",
	status: "all" as const,
	organizationId: "",
};
```

In the browser branch, add `organizationId` to the returned object:

```ts
return {
	search: params.get("search") ?? "",
	status,
	organizationId: params.get("organizationId") ?? "",
};
```

After the existing `status` state, add:

```ts
const [organizationId] = useState(initialFilters.organizationId);
```

Change the query key and action call to:

```ts
queryKey: ["admin-users", search, status, organizationId, page],
queryFn: async () => {
	const result = await listUsersAction(
		{ search, status, organizationId: organizationId || undefined },
		page,
		PAGE_SIZE,
	);
```

In both URL-building blocks inside `handleFilterChange`, add this after the `status` line:

```ts
if (organizationId) params.set("organizationId", organizationId);
```

Add `organizationId` to the `useCallback` dependency array:

```ts
[router, status, organizationId],
```

- [ ] **Step 4: Render membership column**

In the table header, insert this after the user column header:

```tsx
<TableHead>{t("admin:admin.users.table.organizations", "Organizations")}</TableHead>
```

Update the empty table `colSpan` from `5` to `6`.

In each user row, insert this `TableCell` after the user cell and before the platform role cell:

```tsx
<TableCell>
	{user.organizations.length > 0 ? (
		<div className="flex flex-wrap gap-1.5">
			{user.organizations.map((org) => (
				<Badge key={org.id} variant="outline" className="gap-1 font-normal">
					<span>{org.name}</span>
					<span className="text-muted-foreground">·</span>
					<span className="text-muted-foreground">{org.role}</span>
				</Badge>
			))}
		</div>
	) : (
		<span className="text-sm text-muted-foreground">
			{t("admin:admin.users.table.noOrganizations", "No organizations")}
		</span>
	)}
</TableCell>
```

- [ ] **Step 5: Run focused users page test and verify pass**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/users/page.test.tsx'
```

Expected: PASS.

---

### Task 3: Link Organizations To Filtered Users

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx`
- Test: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`

- [ ] **Step 1: Write failing organizations page link test**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`, change the navigation mock to include `Link`:

```ts
vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({
		push: pushMock,
	}),
}));
```

Add this test after the tooltip test:

```ts
it("links organization names and member counts to filtered users", () => {
	useQueryMock.mockReturnValue({
		data: {
			data: [
				{
					id: "org-active",
					name: "Active Org",
					slug: "active-org",
					logo: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					employeeCount: 3,
					memberCount: 4,
					isSuspended: false,
					suspendedReason: null,
					deletedAt: null,
				},
			],
			total: 1,
			page: 1,
			pageSize: 20,
			totalPages: 1,
		},
		isError: false,
		isLoading: false,
		error: null,
	});

	render(<OrganizationsPage />);

	expect(screen.getByRole("link", { name: "Active Org" }).getAttribute("href")).toBe(
		"/platform-admin/users?organizationId=org-active",
	);
	expect(screen.getByRole("link", { name: "4 members" }).getAttribute("href")).toBe(
		"/platform-admin/users?organizationId=org-active",
	);
});
```

- [ ] **Step 2: Run focused organizations page test and verify failure**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx'
```

Expected: FAIL because organization names and member counts are not links.

- [ ] **Step 3: Import `Link` and wrap organization targets**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx`, change:

```ts
import { useRouter } from "@/navigation";
```

to:

```ts
import { Link, useRouter } from "@/navigation";
```

Inside the `organizations.map((org) => (` block, define a link constant immediately after the arrow starts:

```tsx
organizations.map((org) => {
	const usersHref = `/platform-admin/users?organizationId=${encodeURIComponent(org.id)}`;

	return (
		<TableRow key={org.id}>
```

Close the map body by replacing the final `))` for that map expression with `); })` so the JSX remains valid.

Replace the organization name block:

```tsx
<div className="font-medium">{org.name}</div>
```

with:

```tsx
<Link href={usersHref} className="font-medium hover:underline">
	{org.name}
</Link>
```

Replace the member count cell:

```tsx
<TableCell>{org.memberCount}</TableCell>
```

with:

```tsx
<TableCell>
	<Link href={usersHref} className="hover:underline" aria-label={`${org.memberCount} members`}>
		{org.memberCount}
	</Link>
</TableCell>
```

- [ ] **Step 4: Run focused organizations page test and verify pass**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx'
```

Expected: PASS.

---

### Task 4: Full Verification

**Files:**
- Verify modified files only.

- [ ] **Step 1: Run all focused platform-admin tests**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/platform-admin.service.test.ts 'src/app/[locale]/(admin)/platform-admin/users/page.test.tsx' 'src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run formatter/linter if available in package scripts**

Run:

```bash
pnpm --filter webapp lint
```

Expected: PASS. If the script does not exist, record that it was unavailable and rely on the focused tests.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff -- apps/webapp/src/lib/effect/services/platform-admin.service.ts apps/webapp/src/lib/effect/services/platform-admin.service.test.ts 'apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx'
```

Expected: Diff only includes membership data plumbing, users table organization display, organization links, and tests.

---

## Self-Review Notes

- Spec coverage: The plan covers membership visibility on users, filtered user list from organizations, platform-admin-only access via existing actions, empty membership behavior, and focused tests.
- Placeholder scan: No implementation steps rely on undefined placeholders.
- Type consistency: `PlatformUserOrganization`, `PlatformUser.organizations`, `PlatformUserFilters.organizationId`, and `organizationId` URL/query usage are consistent across service, actions, page, and tests.
