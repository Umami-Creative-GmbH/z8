# Employee Access Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable organization-scoped employee suspension, explicit reactivation, and history-preserving removal of organization access.

**Architecture:** Put lifecycle transitions behind employee-settings server actions that derive the active organization from the authenticated actor. Reuse one organization-session revocation helper, block inactive employees at organization-switch and settings-access boundaries, and expose one shared lifecycle UI in directory, detail, and Members views.

**Tech Stack:** Next.js 16 server actions/route handlers, Better Auth organization plugin, Drizzle ORM, Effect, CASL/settings access, TanStack Query, Tolgee, Vitest, Testing Library.

**Dependencies:** Complete `docs/superpowers/plans/2026-07-18-employee-invitation-integrity.md` first, especially the explicit `reconcile | membershipAccepted` provisioning mode.

**Design:** `docs/superpowers/specs/2026-07-18-employee-invitation-lifecycle-design.md`

---

## File Map

**Create:**

- `apps/webapp/src/lib/auth/organization-session-revocation.ts`
- `apps/webapp/src/lib/auth/organization-session-revocation.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.test.ts`
- `apps/webapp/src/components/organization/employee-lifecycle-actions.tsx`
- `apps/webapp/src/components/organization/employee-lifecycle-actions.test.tsx`

**Modify:**

- `apps/webapp/src/lib/auth.ts`
- `apps/webapp/src/lib/auth.test.ts`
- `apps/webapp/src/app/api/organizations/switch/route.ts`
- `apps/webapp/src/app/api/organizations/switch/route.test.ts`
- `apps/webapp/src/lib/auth-helpers.ts`
- `apps/webapp/src/lib/auth-helpers.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
- `apps/webapp/src/lib/query/keys.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`
- `apps/webapp/src/components/organization/members-table.tsx`
- `apps/webapp/src/components/organization/members-table.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`
- `apps/webapp/messages/settings/people/en.json`
- `apps/webapp/messages/settings/people/de.json`
- `apps/webapp/messages/settings/people/es.json`
- `apps/webapp/messages/settings/people/fr.json`
- `apps/webapp/messages/settings/people/gsw.json`
- `apps/webapp/messages/settings/people/it.json`
- `apps/webapp/messages/settings/people/pl.json`
- `apps/webapp/messages/settings/people/pt.json`
- `apps/webapp/messages/settings/people/tr.json`
- `apps/webapp/messages/settings/people/el.json`

Do not modify `apps/webapp/src/db/auth-schema.ts` or global user app-access flags.

### Task 1: Extract Organization-Scoped Session Revocation

**Files:**

- Create: `apps/webapp/src/lib/auth/organization-session-revocation.ts`
- Create: `apps/webapp/src/lib/auth/organization-session-revocation.test.ts`
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/lib/auth.test.ts`

- [ ] **Step 1: Write failing session-revocation tests**

Cover user+organization predicates, database deletion, secondary-storage token deletion, no-op idempotency, preservation of another organization's sessions, and propagation of secondary-storage failures.

```ts
await revokeOrganizationActiveSessions("user-1", "org-a", {
	db,
	secondaryStorage: { delete: deleteStorage },
});

expect(deleteStorage).toHaveBeenCalledWith("org-a-token");
expect(deleteStorage).not.toHaveBeenCalledWith("org-b-token");
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/auth/organization-session-revocation.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the focused helper**

```ts
type SessionRevocationDb = Pick<typeof db, "delete" | "select">;
type SessionRevocationStorage = { delete(token: string): Promise<void> };

export async function revokeOrganizationActiveSessions(
	userId: string,
	organizationId: string,
	dependencies: {
		db: SessionRevocationDb;
		secondaryStorage: SessionRevocationStorage;
	} = {
		db,
		secondaryStorage: { delete: (token) => secondaryStorage.deleteOrThrow(token) },
	},
) {
	const sessions = await dependencies.db
		.select({ token: session.token })
		.from(session)
		.where(
			and(eq(session.userId, userId), eq(session.activeOrganizationId, organizationId)),
		);

	await dependencies.db
		.delete(session)
		.where(
			and(eq(session.userId, userId), eq(session.activeOrganizationId, organizationId)),
		);

	await Promise.all(sessions.map(({ token }) => dependencies.secondaryStorage.delete(token)));
}
```

- [ ] **Step 4: Refactor removal cleanup to reuse it**

Keep `revokeRemovedMemberAccess` responsible for setting employees inactive by `userId + organizationId`, then call `revokeOrganizationActiveSessions`. Keep billing sync in Better Auth's `afterRemoveMember` hook.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/auth/organization-session-revocation.test.ts src/lib/auth.test.ts`

Expected: PASS.

### Task 2: Make Suspension Durable At Access Boundaries

**Files:**

- Modify: `apps/webapp/src/app/api/organizations/switch/route.ts`
- Modify: `apps/webapp/src/app/api/organizations/switch/route.test.ts`
- Modify: `apps/webapp/src/lib/auth-helpers.ts`
- Modify: `apps/webapp/src/lib/auth-helpers.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.test.ts`

- [ ] **Step 1: Write failing organization-switch tests**

Test approved membership, rejection of pending/rejected membership, inactive employee 403, no provisioning for inactive employees, no `setActiveOrganization` call after rejection, and `mode: "reconcile"` only for a genuinely missing employee.

```ts
expect(response.status).toBe(403);
expect(await response.json()).toEqual({ error: "Organization access is inactive" });
expect(ensureEmployeeForOrganizationMember).not.toHaveBeenCalled();
expect(setActiveOrganization).not.toHaveBeenCalled();
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/app/api/organizations/switch/route.test.ts`

Expected: FAIL because inactive rows are currently treated as missing.

- [ ] **Step 3: Query approved membership and employee state explicitly**

```ts
const [membership] = await db
	.select()
	.from(member)
	.where(
		and(
			eq(member.userId, session.user.id),
			eq(member.organizationId, organizationId),
			eq(member.status, "approved"),
		),
	)
	.limit(1);

const [employeeRecord] = await db
	.select()
	.from(employee)
	.where(
		and(
			eq(employee.userId, session.user.id),
			eq(employee.organizationId, organizationId),
		),
	)
	.limit(1);

if (employeeRecord && !employeeRecord.isActive) {
	return NextResponse.json(
		{ error: "Organization access is inactive" },
		{ status: 403, headers: corsHeaders },
	);
}
```

Provision only when no employee row exists, with `mode: "reconcile"`.

- [ ] **Step 4: Verify switch tests pass**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing settings-access tests**

Prove actor membership must be approved; an owner/admin with an existing inactive employee is denied; an approved bootstrap owner with no employee row retains existing access; pending/rejected membership never yields `orgAdmin`.

- [ ] **Step 6: Verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run \
  src/lib/auth-helpers.test.ts \
  "src/app/[locale]/(app)/settings/employees/employee-action-utils.test.ts"
```

Expected: FAIL because membership-derived admin access ignores explicit inactivity.

- [ ] **Step 7: Close membership-only access**

Add `member.status = "approved"` to actor lookups. Load employee rows without filtering `isActive`; reject an existing inactive row before tier resolution. In `getSettingsAccessInputForUser`, suppress both membership and employee settings roles only when an employee row exists with `isActive === false`; preserve the no-employee bootstrap-owner path.

- [ ] **Step 8: Verify GREEN**

Run the Step 6 command plus `pnpm --dir apps/webapp exec vitest run src/lib/settings-access.test.ts`.

Expected: PASS.

### Task 3: Implement Explicit Deactivate And Reactivate Actions

**Files:**

- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`

- [ ] **Step 1: Write failing deactivation tests**

Test authenticated active organization, approved owner/admin actor, regular-member rejection, self-deactivation rejection, `employeeId + organizationId` target and update predicates, organization session revocation, no global app-flag writes, no billing call, durable audit event, idempotent retry, and cross-org not-found behavior.

Owner safety cases:

- Reject an admin attempting to deactivate or reactivate an owner; only another owner may change an owner's lifecycle state.
- Reject deactivation of the only approved active owner.
- Ignore pending/rejected or inactive owners when counting alternatives.
- Allow deactivation when another approved active owner exists.

- [ ] **Step 2: Write failing reactivation tests**

Test owner/admin authorization, approved target membership requirement, no self-control, update of the same employee ID to active, no employee creation, no session revocation, no billing call, audit event, and guidance error when membership was removed.

- [ ] **Step 3: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.test.ts"`

Expected: FAIL because the lifecycle module is missing.

- [ ] **Step 4: Implement explicit public actions around one private transition**

```ts
export async function deactivateEmployeeAction(employeeId: string) {
	return setEmployeeLifecycleState(employeeId, false);
}

export async function reactivateEmployeeAction(employeeId: string) {
	return setEmployeeLifecycleState(employeeId, true);
}
```

Inside `setEmployeeLifecycleState`, use `getEmployeeSettingsActorContext`, require org-admin access, load the target and approved target membership by active organization, reject an admin targeting an owner, enforce self/final-owner rules, and update with:

```ts
.where(
	and(
		eq(employee.id, targetEmployee.id),
		eq(employee.organizationId, actor.organizationId),
	),
)
```

On every deactivation call, revoke organization-active sessions, including an idempotent retry. Log a state-change audit only when `targetEmployee.isActive !== nextIsActive`:

```ts
await logAudit({
	action: nextIsActive
		? AuditAction.EMPLOYEE_REACTIVATED
		: AuditAction.EMPLOYEE_DEACTIVATED,
	actorId: actor.session.user.id,
	actorEmail: actor.session.user.email,
	employeeId: targetEmployee.id,
	targetId: targetEmployee.id,
	targetType: "employee",
	organizationId: actor.organizationId,
	changes: { isActive: { from: targetEmployee.isActive, to: nextIsActive } },
	timestamp: new Date(),
});
```

Native `Date` is appropriate here because this is a database audit boundary, not business-time logic.

- [ ] **Step 5: Export stable client wrappers**

```ts
export async function deactivateEmployee(employeeId: string) {
	return deactivateEmployeeAction(employeeId);
}

export async function reactivateEmployee(employeeId: string) {
	return reactivateEmployeeAction(employeeId);
}
```

- [ ] **Step 6: Verify GREEN**

Run the Step 3 command.

Expected: PASS.

### Task 4: Implement History-Preserving Remove Access

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`

- [ ] **Step 1: Write failing remove-access tests**

Cover approved owner-only authorization, admin rejection, self-removal rejection, organization-scoped employee/member lookups, approved target membership, actual member ID passed to Better Auth, final-owner error translation, and no direct employee/user/history deletion.

```ts
expect(removeMember).toHaveBeenCalledWith({
	body: {
		organizationId: "org-1",
		memberIdOrEmail: "member-target-1",
	},
	headers: expect.any(Headers),
});
expect(removeMember).not.toHaveBeenCalledWith(
	expect.objectContaining({
		body: expect.objectContaining({ memberIdOrEmail: "user-target-1" }),
	}),
);
```

- [ ] **Step 2: Verify RED**

Run Task 3's lifecycle test command.

Expected: FAIL because `removeEmployeeAccessAction` is missing.

- [ ] **Step 3: Implement the owner-only Better Auth call**

```ts
export async function removeEmployeeAccessAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	// Resolve actor organization, target employee, and approved target membership.
	await auth.api.removeMember({
		body: {
			organizationId: actor.organizationId,
			memberIdOrEmail: targetMembership.id,
		},
		headers: await headers(),
	});
	return { success: true };
}
```

Do not set `employee.isActive` here. The existing Better Auth `afterRemoveMember` hook centrally inactivates the organization employee, revokes sessions, and syncs billing. Do not delete employee, user, time, absence, balance, approval, employment-history, or audit rows.

- [ ] **Step 4: Export the client wrapper**

```ts
export async function removeEmployeeAccess(employeeId: string) {
	return removeEmployeeAccessAction(employeeId);
}
```

- [ ] **Step 5: Verify GREEN**

Run Task 3's command and `pnpm --dir apps/webapp exec vitest run src/lib/auth.test.ts`.

Expected: PASS.

### Task 5: Add Membership State To Employee Read Models

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`

- [ ] **Step 1: Write failing type/query tests**

Require real employee list/detail rows to include organization-scoped member ID, role, and status; draft rows expose `membership: null`; inactive employees without membership remain visible; cross-org membership never attaches.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run \
  "src/app/[locale]/(app)/settings/employees/employee-action-types.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts"
```

Expected: FAIL because membership is absent.

- [ ] **Step 3: Add the shared membership summary type**

```ts
import type { member } from "@/db/auth-schema";

export type EmployeeMembershipSummary = Pick<
	typeof member.$inferSelect,
	"id" | "role" | "status"
>;

export type EmployeeWithRelations = typeof employee.$inferSelect & {
	kind: "employee";
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
	membership: EmployeeMembershipSummary | null;
};
```

Add `membership: null` to draft mapping.

- [ ] **Step 4: Join membership with both user and organization**

```ts
.leftJoin(
	member,
	and(
		eq(member.userId, employee.userId),
		eq(member.organizationId, actor.organizationId),
	),
)
```

Normalize left-join output with `membership: row.membership?.id ? row.membership : null`. Apply to list and detail queries, and keep employee detail lookup scoped by employee ID plus organization ID.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 6: Add Organization-Level Query Key Prefixes

**Files:**

- Modify: `apps/webapp/src/lib/query/keys.ts`
- Test: existing query-key test or create `apps/webapp/src/lib/query/keys.test.ts`

- [ ] **Step 1: Write failing key-factory tests**

```ts
expect(queryKeys.members.organization("org-1")).toEqual(["members", "org-1"]);
expect(queryKeys.employees.organization("org-1")).toEqual(["employees", "org-1"]);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/query/keys.test.ts`

Expected: FAIL because the prefix functions are missing.

- [ ] **Step 3: Add stable organization prefixes**

```ts
members: {
	all: ["members"] as const,
	organization: (orgId: string) => ["members", orgId] as const,
	list: <T extends object>(orgId: string, params?: T) => ["members", orgId, params] as const,
},
employees: {
	all: ["employees"] as const,
	organization: (orgId: string) => ["employees", orgId] as const,
	list: <T extends object>(orgId: string, params?: T) => ["employees", orgId, params] as const,
	// retain detail/rate/employment keys
},
```

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 7: Build Shared Lifecycle Controls With Reliable Rollback

**Files:**

- Create: `apps/webapp/src/components/organization/employee-lifecycle-actions.tsx`
- Create: `apps/webapp/src/components/organization/employee-lifecycle-actions.test.tsx`

- [ ] **Step 1: Write failing capability and interaction tests**

Cover:

- Owner: deactivate/reactivate and remove access.
- Admin: deactivate/reactivate, never remove access.
- Member/current user: no lifecycle controls.
- Inactive employee without approved membership: no reactivate/remove controls.
- Confirmation dialogs and exact history-preserving copy.
- Rollback for thrown failures and resolved `{ success: false }` failures.
- Successful invalidation of member organization prefix, employee organization prefix, employee detail, and organizations after removal.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/components/organization/employee-lifecycle-actions.test.tsx`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement target and props contracts**

```ts
export interface EmployeeLifecycleTarget {
	employeeId: string;
	userId: string;
	displayName: string;
	isActive: boolean;
	membership: EmployeeMembershipSummary | null;
}

export interface EmployeeLifecycleActionsProps {
	organizationId: string;
	target: EmployeeLifecycleTarget;
	currentUserId: string;
	currentMemberRole: "owner" | "admin" | "member";
	onOptimisticStatusChange?(isActive: boolean): void;
	onRemoved?(): void;
}
```

- [ ] **Step 4: Use one rejected error path for semantic and network failures**

```ts
async function requireActionSuccess(
	action: () => Promise<ServerActionResult<void>>,
) {
	const result = await action();
	if (!result.success) throw new Error(result.error || "Employee lifecycle action failed");
	return result;
}
```

Return prior state from `onMutate`, restore it in `onError`, and invalidate the keys from Task 6 in `onSuccess`.

- [ ] **Step 5: Implement clear confirmation copy and Tabler icons**

Use `IconPlayerPause`, `IconPlayerPlay`, `IconUserOff`, `IconDots`, and `IconLoader2`.

```text
Deactivate employee?
This suspends access to this organization and ends sessions currently using it. Employee history is retained.

Reactivate employee?
This restores access to this organization using the existing employee record.

Remove organization access?
This removes organization membership and ends organization sessions. Time records, absences, balances, employment history, and audits are retained.
```

The destructive button label is `Remove access`, never `Delete employee`.

- [ ] **Step 6: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 8: Integrate Directory And Detail Views

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`

- [ ] **Step 1: Write failing directory integration tests**

Prove real employees render lifecycle controls, drafts do not, actor identity/role is passed, optimistic status updates modify the row, and remove access keeps the historical row with `isActive: false, membership: null`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run \
  "src/app/[locale]/(app)/settings/employees/columns.test.tsx" \
  "src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx"
```

Expected: FAIL because columns expose only View Details.

- [ ] **Step 3: Convert static columns into a factory**

```ts
export function createEmployeeColumns(options: {
	organizationId: string;
	currentUserId: string;
	currentMemberRole: "owner" | "admin" | "member";
	onEmployeeStatusChange(employeeId: string, isActive: boolean): void;
	onEmployeeAccessRemoved(employeeId: string): void;
}): ColumnDef<EmployeeDirectoryRow>[];
```

For real rows render `ViewDetailsCell` plus `EmployeeLifecycleActions`; for draft rows retain draft-specific actions from the invitation plan.

- [ ] **Step 4: Verify directory tests pass**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing detail integration tests**

Prove active/inactive/membership capability states, no controls for drafts/current user, re-invitation guidance when membership is null, and no redirect after removal.

- [ ] **Step 6: Implement detail controls**

Render `EmployeeLifecycleActions` only for `kind === "employee"`. After successful removal, refetch/update detail to inactive historical state and remain on the page.

- [ ] **Step 7: Verify GREEN**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"`

Expected: PASS.

### Task 9: Replace Members-View Lifecycle Logic And Remove Old Actions

**Files:**

- Modify: `apps/webapp/src/components/organization/members-table.tsx`
- Modify: `apps/webapp/src/components/organization/members-table.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`

- [ ] **Step 1: Write failing Members-view tests**

Require `EmployeeLifecycleActions`, actual `member.id` in target metadata, `Reactivate`/`Remove access` wording, owner/admin differences, semantic rollback, membership-row removal only after success, and invalidation of employee caches.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/components/organization/members-table.test.tsx`

Expected: FAIL because local toggle/removal mutations remain.

- [ ] **Step 3: Replace local lifecycle mutations with the shared component**

```tsx
<EmployeeLifecycleActions
	organizationId={organizationId}
	target={{
		employeeId: employee.id,
		userId: row.original.user.id,
		displayName: row.original.user.name,
		isActive: employee.isActive,
		membership: {
			id: row.original.member.id,
			role: row.original.member.role,
			status: row.original.member.status,
		},
	}}
	currentUserId={currentUserId}
	currentMemberRole={currentMemberRole}
	onOptimisticStatusChange={updateLocalEmployeeStatus}
	onRemoved={removeLocalMembershipRow}
/>
```

- [ ] **Step 4: Delete obsolete server actions after all consumers migrate**

Remove `toggleEmployeeStatus` and the old `removeMember` from organization actions and tests. Do not add compatibility wrappers because there are no external consumers.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 command and the lifecycle action tests.

Expected: PASS.

### Task 10: Add Lifecycle Translations

**Files:** all `apps/webapp/messages/settings/people/*.json` locale catalogs listed in the file map.

- [ ] **Step 1: Add stable English keys and natural translations**

Add keys under `settings.employees.lifecycle`, including:

```json
{
  "deactivate": "Deactivate",
  "reactivate": "Reactivate",
  "removeAccess": "Remove access",
  "deactivateTitle": "Deactivate employee?",
  "deactivateDescription": "This suspends access to this organization and ends sessions currently using it. Employee history is retained.",
  "reactivateTitle": "Reactivate employee?",
  "reactivateDescription": "This restores access to this organization using the existing employee record.",
  "removeTitle": "Remove organization access?",
  "removeDescription": "This removes organization membership and ends organization sessions. Time records, absences, balances, employment history, and audits are retained.",
  "reinviteRequired": "This employee no longer has organization membership. Send a new invitation to restore access."
}
```

Use fallback defaults in component `t()` calls and preserve each catalog's existing JSON structure.

- [ ] **Step 2: Run locale/component tests**

Run: `pnpm --dir apps/webapp exec vitest run src/components/organization/employee-lifecycle-actions.test.tsx "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"`

Expected: PASS without missing-key warnings.

### Task 11: Verify The Workstream

**Files:** all files changed above.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --dir apps/webapp exec vitest run \
  src/lib/auth/organization-session-revocation.test.ts \
  src/lib/auth.test.ts \
  src/lib/auth/organization-member-provisioning.test.ts \
  src/app/api/organizations/switch/route.test.ts \
  src/lib/auth-helpers.test.ts \
  "src/app/[locale]/(app)/settings/employees/employee-action-utils.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-lifecycle.actions.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-action-types.test.ts" \
  src/lib/query/keys.test.ts \
  src/components/organization/employee-lifecycle-actions.test.tsx \
  src/components/organization/members-table.test.tsx \
  "src/app/[locale]/(app)/settings/employees/columns.test.tsx" \
  "src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx" \
  "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"
```

Expected: all tests PASS with no warnings.

- [ ] **Step 2: Run type checking**

Run: `pnpm --dir apps/webapp typecheck`

Expected: exit 0.

- [ ] **Step 3: Run the full webapp suite**

Run: `pnpm --dir apps/webapp test`

Expected: exit 0.

- [ ] **Step 4: Run production build**

Run: `CI=true pnpm --dir apps/webapp build`

Expected: exit 0.

- [ ] **Step 5: Perform manual multi-session verification**

Use one user with sessions active in organizations A and B. Deactivate in A; confirm A-active sessions are revoked, B remains valid, switching into A returns 403, and stale A settings URLs are denied. Reactivate and confirm A access returns. Remove access and confirm membership disappears while employee detail, time entries, absences, balances, employment history, and audits remain.

No commit step is included because repository policy requires an explicit user request before committing.
