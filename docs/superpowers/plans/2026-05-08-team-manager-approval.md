# Team Manager Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-team membership and optional team primary managers, then let any eligible direct or fallback team manager approve requests.

**Architecture:** Add organization-scoped team membership schema and keep `employee.teamId` as a compatibility primary-team field. Centralize approval eligibility in a small resolver so policy resolution, inbox visibility, and approve/reject authorization use the same direct-manager-first rules. Update team settings actions and UI to manage memberships and team primary managers.

**Tech Stack:** Next.js App Router, React, TanStack Form, TanStack Query, Drizzle ORM, PostgreSQL migrations, Effect, Vitest, CASL.

---

## File Structure

- Modify `apps/webapp/src/db/schema/organization.ts`: add `team.primaryManagerId` and new `teamMembership` table.
- Modify `apps/webapp/src/db/schema/relations.ts`: add `teamMembership` relations and replace team member relation usage with memberships.
- Modify `apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts`: add schema assertions for `teamMembership` and `team.primaryManagerId`.
- Create `apps/webapp/drizzle/0013_team_membership_primary_manager.sql`: add database migration and backfill from `employee.team_id`.
- Modify `apps/webapp/drizzle/meta/_journal.json`: register the new migration.
- Create `apps/webapp/src/lib/approvals/policies/manager-eligibility.ts`: pure resolver for direct-manager-first eligible manager sets.
- Create `apps/webapp/src/lib/approvals/policies/manager-eligibility.test.ts`: resolver unit tests.
- Modify `apps/webapp/src/lib/approvals/policies/approver-resolution.ts`: use the new resolver for `direct_manager` stages.
- Modify `apps/webapp/src/lib/approvals/policies/chain-service.ts`: load team memberships and primary manager data for policy resolution.
- Modify `apps/webapp/src/lib/approvals/domain/types.ts`: add `eligibleRequesterEmployeeIds` to approval query parameters.
- Modify `apps/webapp/src/lib/approvals/application/approval-query.service.ts`: pass requester filters and include approvals visible through eligibility.
- Modify `apps/webapp/src/lib/approvals/server/absence-approvals.ts`: make handler queries include eligibility-visible approvals.
- Modify `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`: make handler queries include eligibility-visible approvals.
- Modify `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`: make handler queries include eligibility-visible approvals.
- Modify `apps/webapp/src/app/api/approvals/inbox/route.ts`: include eligibility-aware inbox results for the current manager.
- Modify `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.ts`: allow eligible managers to approve.
- Modify `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.ts`: allow eligible managers to reject.
- Modify `apps/webapp/src/app/api/approvals/inbox/route.test.ts`.
- Modify `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.test.ts`.
- Modify `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.test.ts`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.ts`: manage team memberships and primary manager validation.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.scope.test.ts`: test multi-team add/remove and primary manager validation.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/team-settings-page-data.ts`: load teams through memberships for list/member counts.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/team-scope.ts`: scope members using memberships.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page.tsx`: wire primary manager form state and manager options.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-sections.tsx`: render primary manager select and membership-based member list.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-utils.tsx`: update team page UI state helpers for membership-shaped team data.

## Task 1: Schema And Migration

**Files:**

- Modify: `apps/webapp/src/db/schema/organization.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts`
- Create: `apps/webapp/drizzle/0013_team_membership_primary_manager.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`

- [ ] **Step 1: Write failing schema tests**

Add `teamMembership` to imports in `apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts`:

```ts
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	absenceCategory,
	employee,
	employeeGroup,
	employeeGroupMember,
	location,
	organizationRelations,
	team,
	teamMembership,
} from "@/db/schema";
```

Append these assertions inside `describe("approval policy schema exports", () => { ... })`:

```ts
	it("defines team membership and primary team manager schema", () => {
		expect(team.primaryManagerId.name).toBe("primary_manager_id");
		expect(teamMembership).toBeDefined();
		expect(teamMembership.organizationId.notNull).toBe(true);
		expect(teamMembership.teamId.notNull).toBe(true);
		expect(teamMembership.employeeId.notNull).toBe(true);
		expect(teamMembership.createdBy.notNull).toBe(false);
		expect(uniqueIndexNames(teamMembership)).toEqual(
			expect.arrayContaining(["teamMembership_team_employee_idx"]),
		);
		expect(
			hasCompositeForeignKey(team, ["primary_manager_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(teamMembership, ["team_id", "organization_id"], team, [
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(teamMembership, ["employee_id", "organization_id"], employee, [
				"id",
				"organization_id",
			]),
		).toBe(true);
	});
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/db/schema/__tests__/approval-policy-schema.test.ts
```

Expected: FAIL because `teamMembership` and `team.primaryManagerId` do not exist.

- [ ] **Step 3: Implement schema changes**

In `apps/webapp/src/db/schema/organization.ts`, add imports:

```ts
import {
	boolean,
	decimal,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
```

Add `primaryManagerId` to `team`:

```ts
		primaryManagerId: uuid("primary_manager_id"),
```

Update `team` table indexes:

```ts
	(table) => [
		index("team_organizationId_idx").on(table.organizationId),
		index("team_primaryManagerId_idx").on(table.primaryManagerId),
		unique("team_id_organizationId_idx").on(table.id, table.organizationId),
		foreignKey({
			columns: [table.primaryManagerId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("set null"),
	],
```

Add the `teamMembership` table after `employeeManagers`:

```ts
export const teamMembership = pgTable(
	"team_membership",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
	},
	(table) => [
		index("teamMembership_organizationId_idx").on(table.organizationId),
		index("teamMembership_teamId_idx").on(table.teamId),
		index("teamMembership_employeeId_idx").on(table.employeeId),
		uniqueIndex("teamMembership_team_employee_idx").on(table.teamId, table.employeeId),
		foreignKey({
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
```

In `apps/webapp/src/db/schema/relations.ts`, ensure `teamMembership` is imported through the existing schema imports, then add relations:

```ts
export const teamRelations = relations(team, ({ one, many }) => ({
	organization: one(organization, {
		fields: [team.organizationId],
		references: [organization.id],
	}),
	primaryManager: one(employee, {
		fields: [team.primaryManagerId],
		references: [employee.id],
		relationName: "team_primary_manager",
	}),
	employees: many(employee),
	memberships: many(teamMembership),
	holidayPresetAssignments: many(holidayPresetAssignment),
	holidayAssignments: many(holidayAssignment),
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	workPolicyAssignments: many(workPolicyAssignment),
	projectAssignments: many(projectAssignment),
	surchargeModelAssignments: many(surchargeModelAssignment),
	workCategorySetAssignments: many(workCategorySetAssignment),
	changePolicyAssignments: many(changePolicyAssignment),
}));

export const teamMembershipRelations = relations(teamMembership, ({ one }) => ({
	organization: one(organization, {
		fields: [teamMembership.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [teamMembership.teamId],
		references: [team.id],
	}),
	employee: one(employee, {
		fields: [teamMembership.employeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [teamMembership.createdBy],
		references: [user.id],
	}),
}));
```

Add to `employeeRelations`:

```ts
	teamMemberships: many(teamMembership),
	primaryManagedTeams: many(team, {
		relationName: "team_primary_manager",
	}),
```

- [ ] **Step 4: Add SQL migration and backfill**

Create `apps/webapp/drizzle/0013_team_membership_primary_manager.sql`:

```sql
ALTER TABLE "team" ADD COLUMN "primary_manager_id" uuid;

CREATE TABLE IF NOT EXISTS "team_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);

ALTER TABLE "team" ADD CONSTRAINT "team_primary_manager_org_fk"
	FOREIGN KEY ("primary_manager_id", "organization_id")
	REFERENCES "employee"("id", "organization_id")
	ON DELETE SET NULL;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_organization_id_organization_id_fk"
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_team_org_fk"
	FOREIGN KEY ("team_id", "organization_id")
	REFERENCES "team"("id", "organization_id")
	ON DELETE CASCADE;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_employee_org_fk"
	FOREIGN KEY ("employee_id", "organization_id")
	REFERENCES "employee"("id", "organization_id")
	ON DELETE CASCADE;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_created_by_user_id_fk"
	FOREIGN KEY ("created_by") REFERENCES "user"("id");

CREATE INDEX IF NOT EXISTS "team_primaryManagerId_idx" ON "team" ("primary_manager_id");
CREATE INDEX IF NOT EXISTS "teamMembership_organizationId_idx" ON "team_membership" ("organization_id");
CREATE INDEX IF NOT EXISTS "teamMembership_teamId_idx" ON "team_membership" ("team_id");
CREATE INDEX IF NOT EXISTS "teamMembership_employeeId_idx" ON "team_membership" ("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "teamMembership_team_employee_idx" ON "team_membership" ("team_id", "employee_id");

INSERT INTO "team_membership" ("organization_id", "team_id", "employee_id", "created_by")
SELECT "organization_id", "team_id", "id", NULL
FROM "employee"
WHERE "team_id" IS NOT NULL
ON CONFLICT ("team_id", "employee_id") DO NOTHING;
```

Append to `apps/webapp/drizzle/meta/_journal.json`:

```json
{
  "idx": 13,
  "version": "7",
  "when": 1778200000000,
  "tag": "0013_team_membership_primary_manager",
  "breakpoints": true
}
```

Use the existing JSON array shape in `_journal.json`; add only the object above as the next entry.

- [ ] **Step 5: Run schema test to verify it passes**

Run:

```bash
pnpm --filter webapp test src/db/schema/__tests__/approval-policy-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit schema changes**

Run:

```bash
git add apps/webapp/src/db/schema/organization.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/approval-policy-schema.test.ts apps/webapp/drizzle/0013_team_membership_primary_manager.sql apps/webapp/drizzle/meta/_journal.json
git commit -m "feat: add team memberships and primary managers"
```

Expected: commit succeeds.

## Task 2: Approval Manager Eligibility Resolver

**Files:**

- Create: `apps/webapp/src/lib/approvals/policies/manager-eligibility.ts`
- Create: `apps/webapp/src/lib/approvals/policies/manager-eligibility.test.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/approver-resolution.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `apps/webapp/src/lib/approvals/policies/manager-eligibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveEligibleManagers, resolvePrimaryEligibleManager } from "./manager-eligibility";

const employees = [
	{ id: "requester", organizationId: "org-1", isActive: true, role: "employee" as const },
	{ id: "direct-a", organizationId: "org-1", isActive: true, role: "manager" as const },
	{ id: "direct-b", organizationId: "org-1", isActive: true, role: "manager" as const },
	{ id: "team-manager-a", organizationId: "org-1", isActive: true, role: "manager" as const },
	{ id: "team-manager-b", organizationId: "org-1", isActive: true, role: "admin" as const },
	{ id: "inactive-manager", organizationId: "org-1", isActive: false, role: "manager" as const },
	{ id: "employee-role", organizationId: "org-1", isActive: true, role: "employee" as const },
	{ id: "other-org-manager", organizationId: "org-2", isActive: true, role: "manager" as const },
];

describe("resolveEligibleManagers", () => {
	it("uses active direct managers before team managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [{ employeeId: "requester", managerId: "direct-b" }],
				teamMemberships: [{ employeeId: "requester", teamId: "team-a" }],
				teams: [{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" }],
			}),
		).toEqual({ ok: true, source: "direct", managerIds: ["direct-b"] });
	});

	it("falls back to primary managers for every team membership", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [],
				teamMemberships: [
					{ employeeId: "requester", teamId: "team-a" },
					{ employeeId: "requester", teamId: "team-b" },
				],
				teams: [
					{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" },
					{ id: "team-b", organizationId: "org-1", primaryManagerId: "team-manager-b" },
				],
			}),
		).toEqual({ ok: true, source: "team", managerIds: ["team-manager-a", "team-manager-b"] });
	});

	it("dedupes team managers and ignores invalid managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [{ employeeId: "requester", managerId: "inactive-manager" }],
				teamMemberships: [
					{ employeeId: "requester", teamId: "team-a" },
					{ employeeId: "requester", teamId: "team-b" },
					{ employeeId: "requester", teamId: "team-c" },
					{ employeeId: "requester", teamId: "team-d" },
				],
				teams: [
					{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" },
					{ id: "team-b", organizationId: "org-1", primaryManagerId: "team-manager-a" },
					{ id: "team-c", organizationId: "org-1", primaryManagerId: "employee-role" },
					{ id: "team-d", organizationId: "org-1", primaryManagerId: "other-org-manager" },
				],
			}),
		).toEqual({ ok: true, source: "team", managerIds: ["team-manager-a"] });
	});

	it("returns a clear failure when no eligible manager resolves", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [],
				teamMemberships: [],
				teams: [],
			}),
		).toEqual({ ok: false, reason: "Requester has no active direct or team manager in this organization." });
	});

	it("selects a deterministic display approver", () => {
		expect(
			resolvePrimaryEligibleManager({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [
					{ employeeId: "requester", managerId: "direct-b" },
					{ employeeId: "requester", managerId: "direct-a", isPrimary: true },
				],
				teamMemberships: [],
				teams: [],
			}),
		).toEqual({ ok: true, source: "direct", managerId: "direct-a", managerIds: ["direct-a", "direct-b"] });
	});
});
```

- [ ] **Step 2: Run resolver test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/lib/approvals/policies/manager-eligibility.test.ts
```

Expected: FAIL because `manager-eligibility.ts` does not exist.

- [ ] **Step 3: Implement resolver**

Create `apps/webapp/src/lib/approvals/policies/manager-eligibility.ts`:

```ts
export interface EligibleManagerEmployee {
	id: string;
	organizationId: string;
	isActive: boolean;
	role: "admin" | "manager" | "employee";
}

export interface EligibleManagerLink {
	employeeId: string;
	managerId: string;
	isPrimary?: boolean;
}

export interface EligibleTeamMembership {
	employeeId: string;
	teamId: string;
}

export interface EligibleTeam {
	id: string;
	organizationId: string;
	primaryManagerId: string | null;
}

export interface ResolveEligibleManagersInput {
	organizationId: string;
	requesterEmployeeId: string;
	employees: EligibleManagerEmployee[];
	managerLinks: EligibleManagerLink[];
	teamMemberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
}

export type EligibleManagerResult =
	| { ok: true; source: "direct" | "team"; managerIds: string[] }
	| { ok: false; reason: string };

export type PrimaryEligibleManagerResult =
	| { ok: true; source: "direct" | "team"; managerId: string; managerIds: string[] }
	| { ok: false; reason: string };

function activeManagerInOrg(
	employees: EligibleManagerEmployee[],
	organizationId: string,
	employeeId: string,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId &&
			employee.organizationId === organizationId &&
			employee.isActive &&
			(employee.role === "manager" || employee.role === "admin"),
	);
}

function uniqueSorted(values: string[]) {
	return Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right));
}

function directManagerIds(input: ResolveEligibleManagersInput) {
	const links = input.managerLinks.filter((link) => link.employeeId === input.requesterEmployeeId);
	const primaryIds = links.filter((link) => link.isPrimary).map((link) => link.managerId);
	const otherIds = links.filter((link) => !link.isPrimary).map((link) => link.managerId);

	return uniqueSorted([...primaryIds, ...otherIds]).filter((managerId) =>
		Boolean(activeManagerInOrg(input.employees, input.organizationId, managerId)),
	);
}

function teamManagerIds(input: ResolveEligibleManagersInput) {
	const requesterTeamIds = new Set(
		input.teamMemberships
			.filter((membership) => membership.employeeId === input.requesterEmployeeId)
			.map((membership) => membership.teamId),
	);

	return uniqueSorted(
		input.teams.flatMap((team) =>
			team.organizationId === input.organizationId &&
			requesterTeamIds.has(team.id) &&
			team.primaryManagerId &&
			activeManagerInOrg(input.employees, input.organizationId, team.primaryManagerId)
				? [team.primaryManagerId]
				: [],
		),
	);
}

export function resolveEligibleManagers(input: ResolveEligibleManagersInput): EligibleManagerResult {
	const direct = directManagerIds(input);
	if (direct.length > 0) {
		return { ok: true, source: "direct", managerIds: direct };
	}

	const team = teamManagerIds(input);
	if (team.length > 0) {
		return { ok: true, source: "team", managerIds: team };
	}

	return { ok: false, reason: "Requester has no active direct or team manager in this organization." };
}

export function resolvePrimaryEligibleManager(
	input: ResolveEligibleManagersInput,
): PrimaryEligibleManagerResult {
	const result = resolveEligibleManagers(input);
	if (!result.ok) {
		return result;
	}

	const primaryDirect = input.managerLinks
		.filter((link) => link.employeeId === input.requesterEmployeeId && link.isPrimary)
		.map((link) => link.managerId)
		.filter((managerId) => result.managerIds.includes(managerId))
		.toSorted((left, right) => left.localeCompare(right))[0];

	return {
		ok: true,
		source: result.source,
		managerId: primaryDirect ?? result.managerIds[0],
		managerIds: result.managerIds,
	};
}

export function isEligibleManager(input: ResolveEligibleManagersInput & { managerId: string }) {
	const result = resolveEligibleManagers(input);
	return result.ok && result.managerIds.includes(input.managerId);
}
```

- [ ] **Step 4: Run resolver test to verify it passes**

Run:

```bash
pnpm --filter webapp test src/lib/approvals/policies/manager-eligibility.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update policy approver resolution tests**

In `apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts`, add `teamMemberships` and `teams` to calls, then add:

```ts
	it("resolves direct manager through team fallback when no direct manager exists", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "direct_manager" }),
				employees: [
					...employees,
					{ id: "emp_team_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
				],
				managerLinks: [],
				teamMemberships: [{ employeeId: "emp_requester", teamId: "team_1" }],
				teams: [{ id: "team_1", organizationId: "org_1", primaryManagerId: "emp_team_manager" }],
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_team_manager" });
	});
```

- [ ] **Step 6: Update `approver-resolution.ts`**

Extend the input interface and use the resolver:

```ts
import { resolvePrimaryEligibleManager, type EligibleTeam, type EligibleTeamMembership } from "./manager-eligibility";

interface ResolveApproverFromDirectoryInput {
	organizationId: string;
	requesterEmployeeId: string;
	stage: ApprovalPolicyStageDraft;
	employees: ApproverDirectoryEmployee[];
	managerLinks: ApproverDirectoryManagerLink[];
	teamMemberships?: EligibleTeamMembership[];
	teams?: EligibleTeam[];
}
```

Replace the `direct_manager` case:

```ts
		case "direct_manager": {
			const manager = resolvePrimaryEligibleManager({
				organizationId,
				requesterEmployeeId: requester.id,
				employees,
				managerLinks,
				teamMemberships: input.teamMemberships ?? [],
				teams: input.teams ?? [],
			});

			return manager.ok
				? { ok: true, approverEmployeeId: manager.managerId }
				: { ok: false, reason: manager.reason };
		}
```

Keep `manager_manager` using direct manager links only so it fails when no direct manager exists.

- [ ] **Step 7: Run policy resolution tests**

Run:

```bash
pnpm --filter webapp test src/lib/approvals/policies/manager-eligibility.test.ts src/lib/approvals/policies/approver-resolution.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit resolver changes**

Run:

```bash
git add apps/webapp/src/lib/approvals/policies/manager-eligibility.ts apps/webapp/src/lib/approvals/policies/manager-eligibility.test.ts apps/webapp/src/lib/approvals/policies/approver-resolution.ts apps/webapp/src/lib/approvals/policies/approver-resolution.test.ts
git commit -m "feat: resolve approval managers from teams"
```

Expected: commit succeeds.

## Task 3: Policy Chain Resolver Integration

**Files:**

- Modify: `apps/webapp/src/lib/approvals/policies/chain-service.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`

- [ ] **Step 1: Write failing chain-service test**

In `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`, add a test that creates a `direct_manager` policy stage, returns no direct `employeeManagers`, returns a requester `teamMembership`, and returns a `team` with `primaryManagerId`. Assert that the first inserted `approvalRequest` uses the team manager ID:

```ts
	it("resolves direct manager policy stages through team primary manager fallback", async () => {
		const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
		const dbService = createPolicyDbService({
			policies: [
				{
					id: "policy-1",
					organizationId: "org-1",
					name: "Absence policy",
					isActive: true,
					priority: 1,
					conditions: [],
					stages: [{ id: "stage-1", stepOrder: 1, label: "Manager", approverType: "direct_manager" }],
				},
			],
			employees: [
				{ id: "requester", organizationId: "org-1", userId: "user-requester", isActive: true, role: "employee" },
				{ id: "team-manager", organizationId: "org-1", userId: "user-manager", isActive: true, role: "manager" },
			],
			employeeManagers: [],
			teamMemberships: [{ employeeId: "requester", teamId: "team-1" }],
			teams: [{ id: "team-1", organizationId: "org-1", primaryManagerId: "team-manager" }],
			onInsert: inserts,
		});

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: {
					organizationId: "org-1",
					approvalType: "absence_entry",
					requesterEmployeeId: "requester",
					teamId: null,
					locationId: null,
					absenceCategoryId: null,
					travelExpenseAmount: null,
					overtimeRisk: null,
					employeeGroupIds: [],
					entityType: "absence_entry",
					entityId: "absence-1",
				},
				defaultApproverId: "fallback-manager",
			}),
		);

		expect(result.kind).toBe("chain_created");
		expect(inserts.some((insert) => insert.values.approverId === "team-manager")).toBe(true);
	});
```

- [ ] **Step 2: Run chain-service test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/lib/approvals/policies/chain-service.test.ts
```

Expected: FAIL because chain service does not load team memberships or teams.

- [ ] **Step 3: Load memberships and teams in chain service**

In `apps/webapp/src/lib/approvals/policies/chain-service.ts`, import `team` and `teamMembership` from `@/db/schema`, then update `loadPolicyContext`:

```ts
	const [policies, groupRows, activeGroups, employees, managerLinks, teamMemberships, teams] = await Promise.all([
		dbService.db.query.approvalPolicy.findMany({
			where: eq(approvalPolicy.organizationId, context.organizationId),
			orderBy: [asc(approvalPolicy.priority)],
			with: { conditions: true, stages: true },
		}),
		context.employeeGroupIds.length === 0
			? dbService.db.query.employeeGroupMember.findMany({
					where: and(
						eq(employeeGroupMember.organizationId, context.organizationId),
						eq(employeeGroupMember.employeeId, context.requesterEmployeeId),
					),
				})
			: Promise.resolve([]),
		dbService.db.query.employeeGroup.findMany({
			where: and(eq(employeeGroup.organizationId, context.organizationId), eq(employeeGroup.isActive, true)),
		}),
		dbService.db.query.employee.findMany({
			where: eq(employee.organizationId, context.organizationId),
		}),
		dbService.db.query.employeeManagers.findMany(),
		dbService.db.query.teamMembership.findMany({
			where: and(
				eq(teamMembership.organizationId, context.organizationId),
				eq(teamMembership.employeeId, context.requesterEmployeeId),
			),
		}),
		dbService.db.query.team.findMany({
			where: eq(team.organizationId, context.organizationId),
		}),
	]);
```

Return `teamMemberships` and `teams` from `loadPolicyContext`, then pass them into each `resolveApproverFromDirectory` call:

```ts
	const resolution = resolveApproverFromDirectory({
		organizationId: loaded.context.organizationId,
		requesterEmployeeId: loaded.context.requesterEmployeeId,
		stage,
		employees: loaded.employees,
		managerLinks: loaded.managerLinks,
		teamMemberships: loaded.teamMemberships,
		teams: loaded.teams,
	});
```

- [ ] **Step 4: Update approval server mocks**

In `absence-approvals.test.ts`, `time-correction-approvals.test.ts`, and `travel-expense-approvals.test.ts`, add empty query mocks in each test db service definition under `db.query`:

```ts
teamMembership: {
	findMany: vi.fn(() => Promise.resolve([])),
},
team: {
	findMany: vi.fn(() => Promise.resolve([])),
},
```

- [ ] **Step 5: Run policy and server tests**

Run:

```bash
pnpm --filter webapp test src/lib/approvals/policies/chain-service.test.ts src/lib/approvals/server/absence-approvals.test.ts src/lib/approvals/server/time-correction-approvals.test.ts src/lib/approvals/server/travel-expense-approvals.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit chain integration**

Run:

```bash
git add apps/webapp/src/lib/approvals/policies/chain-service.ts apps/webapp/src/lib/approvals/policies/chain-service.test.ts apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts
git commit -m "feat: use team managers in approval policies"
```

Expected: commit succeeds.

## Task 4: Inbox Visibility And Approve/Reject Authorization

**Files:**

- Modify: `apps/webapp/src/lib/approvals/application/approval-query.service.ts`
- Modify: `apps/webapp/src/lib/approvals/domain/types.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.test.ts`

- [ ] **Step 1: Write failing route authorization tests**

In approve and reject route tests, mock `isEligibleManagerForApprovalRequest` from the new resolver adapter and add:

```ts
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	isEligibleManagerForApprovalRequest: mockState.isEligibleManagerForApprovalRequest,
}));
```

Add to `mockState`:

```ts
isEligibleManagerForApprovalRequest: vi.fn(async () => false),
```

Add this approve test:

```ts
	it("allows an eligible fallback team manager to approve a request assigned to another manager", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(true);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.handlerApprove).toHaveBeenCalledWith("entity-1", "employee-1", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});
```

Add the same shape to reject route test, replacing `handlerApprove` with `handlerReject` and calling the reject route.

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
pnpm --filter webapp test src/app/api/approvals/inbox/[id]/approve/route.test.ts src/app/api/approvals/inbox/[id]/reject/route.test.ts
```

Expected: FAIL because the db-backed eligibility helper does not exist and routes do not call it.

- [ ] **Step 3: Create db-backed eligibility helper**

Create `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { approvalRequest, employee, employeeManagers, team, teamMembership } from "@/db/schema";
import { isEligibleManager } from "./manager-eligibility";

export async function isEligibleManagerForApprovalRequest(input: {
	db: any;
	approvalRequestId: string;
	managerEmployeeId: string;
	organizationId: string;
}) {
	const request = await input.db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalRequestId),
			eq(approvalRequest.organizationId, input.organizationId),
		),
	});

	if (!request) {
		return false;
	}

	const [employees, managerLinks, memberships, teams] = await Promise.all([
		input.db.query.employee.findMany({ where: eq(employee.organizationId, input.organizationId) }),
		input.db.query.employeeManagers.findMany(),
		input.db.query.teamMembership.findMany({
			where: and(
				eq(teamMembership.organizationId, input.organizationId),
				eq(teamMembership.employeeId, request.requestedBy),
			),
		}),
		input.db.query.team.findMany({ where: eq(team.organizationId, input.organizationId) }),
	]);

	return isEligibleManager({
		organizationId: input.organizationId,
		requesterEmployeeId: request.requestedBy,
		employees,
		managerLinks,
		teamMemberships: memberships,
		teams,
		managerId: input.managerEmployeeId,
	});
}
```

- [ ] **Step 4: Update approve and reject routes**

In both route files, import the helper:

```ts
import { isEligibleManagerForApprovalRequest } from "@/lib/approvals/policies/manager-eligibility-db";
```

Replace authorization check with:

```ts
		const canManageApprovals = ability.cannot("manage", "Approval") === false;
		const isAssignedApprover = request.approverId === currentEmployee.id;
		const isEligibleManager = isAssignedApprover
			? true
			: await isEligibleManagerForApprovalRequest({
					db,
					approvalRequestId: request.id,
					managerEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				});

		if (!isAssignedApprover && !isEligibleManager && !canManageApprovals) {
			return NextResponse.json(
				{ error: "You are not authorized to approve this request" },
				{ status: 403 },
			);
		}
```

For reject route, use the existing reject-specific error text.

Set handler options for eligible managers:

```ts
		const handlerOptions =
			request.approverId !== currentEmployee.id
				? { approvalRequestId: request.id, allowAnyApprover: true }
				: undefined;
```

- [ ] **Step 5: Add inbox visibility path**

In `apps/webapp/src/lib/approvals/domain/types.ts`, extend `ApprovalQueryParams`:

```ts
	eligibleRequesterEmployeeIds?: string[];
```

In `apps/webapp/src/app/api/approvals/inbox/route.ts`, compute eligible requesters before calling `ApprovalQueryService`:

```ts
import { getEligibleRequesterIdsForManager } from "@/lib/approvals/policies/manager-eligibility-db";

const eligibleRequesterEmployeeIds = await getEligibleRequesterIdsForManager({
	db,
	managerEmployeeId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
});

const params: ApprovalQueryParams = {
	approverId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
	status,
	types,
	teamId,
	search,
	priority,
	minAgeDays,
	dateRange,
	cursor,
	limit,
	eligibleRequesterEmployeeIds,
};
```

Add `getEligibleRequesterIdsForManager` to `manager-eligibility-db.ts`:

```ts
export async function getEligibleRequesterIdsForManager(input: {
	db: any;
	managerEmployeeId: string;
	organizationId: string;
}) {
	const [employees, managerLinks, memberships, teams] = await Promise.all([
		input.db.query.employee.findMany({ where: eq(employee.organizationId, input.organizationId) }),
		input.db.query.employeeManagers.findMany(),
		input.db.query.teamMembership.findMany({ where: eq(teamMembership.organizationId, input.organizationId) }),
		input.db.query.team.findMany({ where: eq(team.organizationId, input.organizationId) }),
	]);

	return employees.flatMap((requester: { id: string }) =>
		isEligibleManager({
			organizationId: input.organizationId,
			requesterEmployeeId: requester.id,
			employees,
			managerLinks,
			teamMemberships: memberships,
			teams,
			managerId: input.managerEmployeeId,
		})
			? [requester.id]
			: [],
	);
}
```

In `approval-query.service.ts`, merge the existing requester filters with eligibility:

```ts
					const requesterEmployeeIds = params.requesterEmployeeIds ?? params.eligibleRequesterEmployeeIds;
```

Ensure handler calls receive `eligibleRequesterEmployeeIds` through `params` so handlers can include requests assigned to other approvers for those requesters.

- [ ] **Step 6: Update handler query filters**

In each handler `getApprovals` implementation that filters by `approverId`, include `params.eligibleRequesterEmployeeIds` as an OR condition with the existing assigned approver condition. Use the existing handler's query style. The condition must be equivalent to:

```ts
or(
	eq(approvalRequest.approverId, params.approverId),
	params.eligibleRequesterEmployeeIds && params.eligibleRequesterEmployeeIds.length > 0
		? inArray(approvalRequest.requestedBy, params.eligibleRequesterEmployeeIds)
		: undefined,
)
```

Import `inArray` and `or` from `drizzle-orm` in `absence-approvals.ts`, `time-correction-approvals.ts`, and `travel-expense-approvals.ts`.

- [ ] **Step 7: Run inbox and route tests**

Run:

```bash
pnpm --filter webapp test src/app/api/approvals/inbox/route.test.ts src/app/api/approvals/inbox/[id]/approve/route.test.ts src/app/api/approvals/inbox/[id]/reject/route.test.ts src/lib/approvals/application/approval-query.service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit inbox authorization changes**

Run:

```bash
git add apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts apps/webapp/src/lib/approvals/application/approval-query.service.ts apps/webapp/src/lib/approvals/domain/types.ts apps/webapp/src/lib/approvals/server apps/webapp/src/app/api/approvals/inbox
git commit -m "feat: allow eligible managers to action approvals"
```

Expected: commit succeeds.

## Task 5: Team Settings Server Actions

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.scope.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/team-settings-page-data.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/team-scope.ts`

- [ ] **Step 1: Write failing action tests**

In `actions.scope.test.ts`, extend schema mocks with `teamMembership` and add db query mocks for `teamMembership.findMany` and `teamMembership.findFirst`. Add tests:

```ts
	it("adds team membership without moving an employee out of another team", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{ id: "target-1", userId: "user-2", organizationId: "org-1", role: "employee", teamId: "team-a", user: { id: "user-2", name: "Target", email: "target@example.com" } },
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.teamMembershipFindFirst.mockResolvedValue(null);

		const result = await addTeamMember("team-b", "target-1");

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: "team-b", employeeId: "target-1", organizationId: "org-1" }),
		);
		expect(mockState.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-b" }));
	});

	it("rejects primary manager assignment for employee role", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{ id: "employee-1", userId: "user-2", organizationId: "org-1", role: "employee", isActive: true },
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null }];

		const result = await updateTeam("team-a", { primaryManagerId: "employee-1" });

		expect(result.success).toBe(false);
		expect(result.error).toBe("Primary manager must be an active manager or admin in this organization");
	});
```

- [ ] **Step 2: Run action tests to verify they fail**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/settings/teams/actions.scope.test.ts
```

Expected: FAIL because actions still mutate `employee.teamId` as the membership source of truth.

- [ ] **Step 3: Update validation schemas and imports**

In `actions.ts`, import `teamMembership` and update schema:

```ts
import { employee, team, teamMembership, teamPermissions } from "@/db/schema";

const updateTeamSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long").optional(),
	description: z.string().max(500, "Description is too long").optional().nullable(),
	primaryManagerId: z.string().uuid().nullable().optional(),
});
```

Add validation helper:

```ts
function validatePrimaryManager(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	primaryManagerId: string | null | undefined,
) {
	if (!primaryManagerId) {
		return Effect.succeed(undefined);
	}

	return Effect.gen(function* (_) {
		const manager = yield* _(
			dbService.query("getPrimaryManagerCandidate", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, primaryManagerId),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
				});
			}),
		);

		if (!manager || (manager.role !== "manager" && manager.role !== "admin")) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "Primary manager must be an active manager or admin in this organization",
						field: "primaryManagerId",
						value: primaryManagerId,
					}),
				),
			);
		}
	});
}
```

- [ ] **Step 4: Update `updateTeam`**

After `const validatedData = validationResult.data;`, call:

```ts
	yield* _(validatePrimaryManager(dbService, targetTeam.organizationId, validatedData.primaryManagerId));
```

Keep the update object explicit:

```ts
	const updateValues = {
		...(validatedData.name !== undefined ? { name: validatedData.name } : {}),
		...(validatedData.description !== undefined ? { description: validatedData.description } : {}),
		...(validatedData.primaryManagerId !== undefined
			? { primaryManagerId: validatedData.primaryManagerId }
			: {}),
		updatedAt: currentTimestamp(),
	};
```

Use `updateValues` in the update query.

- [ ] **Step 5: Update `getTeam`, `listTeams`, and delete checks**

Load memberships instead of `employees` relation:

```ts
	with: {
		memberships: {
			with: {
				employee: { with: { user: true } },
			},
		},
		primaryManager: { with: { user: true } },
	},
```

Map returned teams to keep UI compatibility:

```ts
function withMembershipEmployees<T extends { memberships?: Array<{ employee: unknown }> }>(teamRecord: T) {
	return {
		...teamRecord,
		employees: teamRecord.memberships?.map((membership) => membership.employee) ?? [],
	};
}
```

For delete checks, query `teamMembership`:

```ts
	const members = yield* _(
		dbService.query("getTeamMemberships", async () => {
			return await dbService.db.query.teamMembership.findMany({
				where: and(
					eq(teamMembership.organizationId, targetTeam.organizationId),
					eq(teamMembership.teamId, teamId),
				),
			});
		}),
	);
```

- [ ] **Step 6: Update add and remove member actions**

Replace the `employee.teamId` update in `addTeamMember` with membership insert plus compatibility update only when needed:

```ts
	const existingMembership = yield* _(
		dbService.query("getExistingTeamMembership", async () => {
			return await dbService.db.query.teamMembership.findFirst({
				where: and(
					eq(teamMembership.organizationId, targetTeam.organizationId),
					eq(teamMembership.teamId, teamId),
					eq(teamMembership.employeeId, targetEmployee.id),
				),
			});
		}),
	);

	if (!existingMembership) {
		yield* _(
			dbService.query("addTeamMembership", async () => {
				await dbService.db.insert(teamMembership).values({
					organizationId: targetTeam.organizationId,
					teamId,
					employeeId: targetEmployee.id,
					createdBy: session.user.id,
				});
			}),
		);
	}

	if (!targetEmployee.teamId) {
		yield* _(
			dbService.query("setEmployeePrimaryTeamCompatibility", async () => {
				await dbService.db
					.update(employee)
					.set({ teamId, updatedAt: currentTimestamp() })
					.where(eq(employee.id, targetEmployee.id));
			}),
		);
	}
```

Replace removal with delete membership and compatibility reassignment:

```ts
	yield* _(
		dbService.query("removeTeamMembership", async () => {
			await dbService.db
				.delete(teamMembership)
				.where(
					and(
						eq(teamMembership.organizationId, targetTeam.organizationId),
						eq(teamMembership.teamId, teamId),
						eq(teamMembership.employeeId, employeeId),
					),
				);
		}),
	);

	if (targetEmployee?.teamId === teamId) {
		const remainingMemberships = yield* _(
			dbService.query("getRemainingTeamMemberships", async () => {
				return await dbService.db.query.teamMembership.findMany({
					where: and(
						eq(teamMembership.organizationId, targetTeam.organizationId),
						eq(teamMembership.employeeId, employeeId),
					),
				});
			}),
		);

		const nextTeamId = remainingMemberships
			.map((membership) => membership.teamId)
			.filter((remainingTeamId) => remainingTeamId !== teamId)
			.toSorted()[0] ?? null;

		yield* _(
			dbService.query("updateEmployeePrimaryTeamCompatibility", async () => {
				await dbService.db
					.update(employee)
					.set({ teamId: nextTeamId, updatedAt: currentTimestamp() })
					.where(eq(employee.id, employeeId));
			}),
		);
	}
```

- [ ] **Step 7: Update team settings page data and scoping**

In `team-settings-page-data.ts`, load `teamMembership` rows with employees and users. Keep `scopedMembers` filtered by whether an employee has at least one membership in a manageable team.

In `team-scope.ts`, update `filterMembersForTeamSettingsSurface` input type:

```ts
export function filterMembersForTeamSettingsSurface<
	T extends { employee: { id: string; teamId: string | null } | null; teamMemberships?: Array<{ teamId: string }> },
>(input: {
	members: T[];
	manageableTeamIds: Set<string>;
	canAccessOrganizationAdminSurface: boolean;
}): T[] {
	if (input.canAccessOrganizationAdminSurface) {
		return input.members;
	}

	return input.members.filter((entry) =>
		entry.teamMemberships?.some((membership) => input.manageableTeamIds.has(membership.teamId)) ||
		(entry.employee?.teamId && input.manageableTeamIds.has(entry.employee.teamId)),
	);
}
```

- [ ] **Step 8: Run action tests**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/settings/teams/actions.scope.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit team action changes**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/teams/actions.ts apps/webapp/src/app/[locale]/\(app\)/settings/teams/actions.scope.test.ts apps/webapp/src/app/[locale]/\(app\)/settings/teams/team-settings-page-data.ts apps/webapp/src/app/[locale]/\(app\)/settings/teams/team-scope.ts
git commit -m "feat: manage multi-team memberships"
```

Expected: commit succeeds.

## Task 6: Team Settings UI

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-sections.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-utils.tsx`

- [ ] **Step 1: Update form value types**

In `page-utils.tsx`, update `TeamFormValues`:

```ts
export type TeamFormValues = {
	name?: string;
	description?: string | null;
	primaryManagerId?: string | null;
};
```

Update `extractTeamMemberIds` to support membership-shaped teams:

```ts
export function extractTeamMemberIds(team: any): string[] {
	return team.employees?.map((employee: any) => employee.id) ?? [];
}
```

- [ ] **Step 2: Load primary manager candidates**

In `page.tsx`, add state through existing reducer or a local query for managers:

```ts
const { data: managerOptions = [] } = useQuery({
	queryKey: ["teams", teamId, "primary-manager-options"],
	queryFn: async () => {
		const result = await listEmployeesForSelect({ limit: 1000 });
		if (!result.success) {
			throw new Error(result.error || "Failed to load manager options");
		}
		return result.data.employees.filter(
			(employee) => employee.role === "manager" || employee.role === "admin",
		);
	},
	enabled: canManageSettings,
});
```

If `SelectableEmployee` does not include `role`, update `listEmployeesForSelect` to include it and adjust its tests.

- [ ] **Step 3: Wire edit form defaults**

Update `form` default values:

```ts
const form = useForm({
	defaultValues: { name: "", description: "", primaryManagerId: null as string | null },
	onSubmit: async ({ value }) => updateTeamMutation.mutate(value),
});
```

Update edit reset:

```ts
form.reset({
	name: team.name,
	description: team.description || "",
	primaryManagerId: team.primaryManagerId ?? null,
});
```

Pass manager options to `TeamInfoCard`:

```tsx
<TeamInfoCard
	team={team}
	managerOptions={managerOptions}
	isEditing={uiState.isEditing}
	canManageSettings={canManageSettings}
	loading={loading}
	form={form}
	onStartEdit={() => {
		dispatch({ type: "setEditing", value: true });
		form.reset({ name: team.name, description: team.description || "", primaryManagerId: team.primaryManagerId ?? null });
	}}
	onCancelEdit={() => dispatch({ type: "setEditing", value: false })}
	onSubmit={() => form.handleSubmit()}
/>
```

- [ ] **Step 4: Render primary manager control**

In `page-sections.tsx`, extend props:

```ts
export function TeamInfoCard(props: {
	team: any;
	managerOptions: SelectableEmployee[];
	isEditing: boolean;
	canManageSettings: boolean;
	loading: boolean;
	form: any;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onSubmit: () => void;
})
```

Inside editing UI after description field:

```tsx
<form.Field name="primaryManagerId">
	{(field: any) => (
		<div className="space-y-2">
			<Label>Primary Manager</Label>
			<Select
				value={field.state.value ?? "none"}
				onValueChange={(value) => field.handleChange(value === "none" ? null : value)}
			>
				<SelectTrigger>
					<SelectValue placeholder="No primary manager assigned" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none">No primary manager assigned</SelectItem>
					{managerOptions.map((employee) => (
						<SelectItem key={employee.id} value={employee.id}>
							{employee.user.name} ({employee.user.email})
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)}
</form.Field>
```

In read-only UI after description:

```tsx
<Separator />
<div className="space-y-2">
	<div className="text-sm text-muted-foreground">Primary Manager</div>
	<div className="font-medium">
		{team.primaryManager?.user?.name ?? "No primary manager assigned"}
	</div>
</div>
```

- [ ] **Step 5: Run focused UI tests or typecheck**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/settings/teams/actions.scope.test.ts
pnpm --filter webapp test src/components/settings/settings-config.test.ts
```

Expected: PASS. If the test command reports TypeScript prop/type errors, update the exact component props in `page.tsx`, `page-sections.tsx`, and `page-utils.tsx`, then rerun the same command until it passes.

- [ ] **Step 6: Commit UI changes**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/teams/[teamId]/page.tsx apps/webapp/src/app/[locale]/\(app\)/settings/teams/[teamId]/page-sections.tsx apps/webapp/src/app/[locale]/\(app\)/settings/teams/[teamId]/page-utils.tsx
git commit -m "feat: edit team primary managers"
```

Expected: commit succeeds.

## Task 7: Final Verification And Cleanup

**Files:**

- Modify: files touched by failing checks only.
- Review: `docs/superpowers/specs/2026-05-08-team-manager-approval-design.md`

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
pnpm --filter webapp test src/db/schema/__tests__/approval-policy-schema.test.ts src/lib/approvals/policies/manager-eligibility.test.ts src/lib/approvals/policies/approver-resolution.test.ts src/lib/approvals/policies/chain-service.test.ts src/app/api/approvals/inbox/route.test.ts src/app/api/approvals/inbox/[id]/approve/route.test.ts src/app/api/approvals/inbox/[id]/reject/route.test.ts src/app/[locale]/\(app\)/settings/teams/actions.scope.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader webapp tests**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS.

- [ ] **Step 3: Review changed SQL and schema drift**

Run:

```bash
git diff -- apps/webapp/src/db/schema/organization.ts apps/webapp/drizzle/0013_team_membership_primary_manager.sql
```

Expected: diff shows `team.primary_manager_id`, `team_membership`, and backfill only.

- [ ] **Step 4: Run worktree status**

Run:

```bash
git status --short
```

Expected: only intentional files are modified or untracked. Unrelated pre-existing worktree changes remain untouched.

- [ ] **Step 5: Final commit if fixes were needed**

When Step 1 or Step 2 required fixes, commit those fixes:

```bash
git add apps/webapp/src apps/webapp/drizzle
git commit -m "fix: stabilize team manager approvals"
```

Expected: commit succeeds when verification fixes changed files. When `git status --short` shows no files changed after verification, do not run this commit command.

## Self-Review Notes

- Spec coverage: schema, migration/backfill, direct-manager-first approval resolution, any-one approval actioning, team settings behavior, UI, and testing are covered by Tasks 1-7.
- Placeholder scan: this plan contains concrete paths, code snippets, commands, and expected outcomes for each task.
- Type consistency: resolver types are introduced in Task 2 and reused by policy resolution and route authorization tasks.
