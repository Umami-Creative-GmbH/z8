# Scoped Payroll Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build scoped payroll access so non-admin payroll employees can view assigned payroll data, download a combined PDF, and trigger existing payroll exports without gaining manager/admin access.

**Architecture:** Add organization-scoped payroll access grant tables, resolve payroll-visible employees server-side, and route payroll summaries/exports through a dedicated `/payroll` workspace. Keep `/settings/payroll-export` admin-only for configuration, and reuse the existing payroll export infrastructure after intersecting requested filters with the payroll user's resolved employee scope.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL migrations, Effect server actions, Luxon, `@react-pdf/renderer`, Tolgee, Vitest, Testing Library, shadcn/ui, `@tanstack/react-form`, `@tabler/icons-react`.

---

## Scope Check

The approved spec includes one cohesive feature with three tightly-coupled surfaces: scoped access data, payroll data/export actions, and UI. Implement in small commits so the data model and authorization can be verified before the UI relies on them.

## File Structure

Create or modify these files:

- Create `apps/webapp/src/db/schema/payroll-access.ts`: Drizzle tables for payroll access grants, team assignments, and employee assignments.
- Modify `apps/webapp/src/db/schema/index.ts`: export the new schema file.
- Modify `apps/webapp/src/db/schema/relations.ts`: add relations for payroll access tables.
- Create `apps/webapp/drizzle/0047_scoped_payroll_access.sql`: SQL migration for new tables and indexes.
- Modify `apps/webapp/drizzle/meta/_journal.json`: add migration entry `0047_scoped_payroll_access` with `when` greater than `1780304304747`.
- Create `apps/webapp/src/lib/payroll-access/permissions.ts`: admin/manage checks, active grant lookup, scoped employee/team resolution, and filter intersection.
- Create `apps/webapp/src/lib/payroll-access/permissions.test.ts`: tests for admin, team, employee, future team members, and no implicit self-access.
- Create `apps/webapp/src/lib/payroll-workspace/types.ts`: shared workspace types.
- Create `apps/webapp/src/lib/payroll-workspace/summary.ts`: server-side payroll summary and blocker aggregation.
- Create `apps/webapp/src/lib/payroll-workspace/summary.test.ts`: unit tests for total hours, absence days, and blocker warnings.
- Create `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx`: combined PDF generator and filename helper using `@react-pdf/renderer`.
- Create `apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx`: smoke tests for filename and PDF bytes.
- Create `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`: server actions for page data, PDF export, and scoped payroll system export.
- Create `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`: server action scope tests.
- Create `apps/webapp/src/app/[locale]/(app)/payroll/page.tsx`: server page shell.
- Create `apps/webapp/src/components/payroll/payroll-workspace.tsx`: client workspace UI.
- Create `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`: UI tests.
- Create `apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx`: admin assignment form with TanStack Form.
- Create `apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx`: form tests.
- Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx`: admin page for assigning payroll access.
- Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts`: admin assignment actions.
- Modify `apps/webapp/src/components/server-app-sidebar.tsx`: compute `showPayrollNav`.
- Modify `apps/webapp/src/components/app-sidebar.tsx`: render Payroll nav item when allowed.
- Modify `apps/webapp/src/components/app-sidebar.test.tsx`: sidebar visibility tests.
- Modify `apps/webapp/src/lib/app-search/static-results.ts` and `apps/webapp/src/lib/app-search/static-commands.ts` if payroll appears in app search.

## Task 1: Schema And Migration

**Files:**
- Create: `apps/webapp/src/db/schema/payroll-access.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/drizzle/0047_scoped_payroll_access.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Test: `apps/webapp/src/db/schema/__tests__/payroll-access-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `apps/webapp/src/db/schema/__tests__/payroll-access-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollAccessTeam,
} from "@/db/schema";

function tableColumnNames(table: { [key: string]: unknown }): string[] {
	return Object.keys(table).filter((key) => !key.startsWith("_") && key !== "enableRLS");
}

describe("payroll access schema", () => {
	it("defines organization-scoped grant and assignment tables", () => {
		expect(tableColumnNames(payrollAccessGrant)).toEqual(
			expect.arrayContaining([
				"id",
				"organizationId",
				"payrollEmployeeId",
				"isActive",
				"createdAt",
				"createdBy",
				"updatedAt",
				"updatedBy",
			]),
		);
		expect(tableColumnNames(payrollAccessTeam)).toEqual(
			expect.arrayContaining(["id", "organizationId", "grantId", "teamId", "createdAt", "createdBy"]),
		);
		expect(tableColumnNames(payrollAccessEmployee)).toEqual(
			expect.arrayContaining([
				"id",
				"organizationId",
				"grantId",
				"employeeId",
				"createdAt",
				"createdBy",
			]),
		);
	});
});
```

- [ ] **Step 2: Run the failing schema test**

Run: `pnpm --filter @z8/webapp test src/db/schema/__tests__/payroll-access-schema.test.ts`

Expected: FAIL because `payrollAccessGrant`, `payrollAccessTeam`, and `payrollAccessEmployee` are not exported.

- [ ] **Step 3: Add the Drizzle schema**

Create `apps/webapp/src/db/schema/payroll-access.ts`:

```ts
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { employee, team } from "./organization";

export const payrollAccessGrant = pgTable(
	"payroll_access_grant",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		payrollEmployeeId: uuid("payroll_employee_id").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").notNull().references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("payrollAccessGrant_organizationId_idx").on(table.organizationId),
		index("payrollAccessGrant_payrollEmployeeId_idx").on(table.payrollEmployeeId),
		uniqueIndex("payrollAccessGrant_active_employee_idx")
			.on(table.organizationId, table.payrollEmployeeId)
			.where(sql`is_active = true`),
		foreignKey({
			columns: [table.payrollEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

export const payrollAccessTeam = pgTable(
	"payroll_access_team",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		grantId: uuid("grant_id")
			.notNull()
			.references(() => payrollAccessGrant.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").notNull().references(() => user.id),
	},
	(table) => [
		index("payrollAccessTeam_organizationId_idx").on(table.organizationId),
		index("payrollAccessTeam_grantId_idx").on(table.grantId),
		index("payrollAccessTeam_teamId_idx").on(table.teamId),
		uniqueIndex("payrollAccessTeam_grant_team_idx").on(table.grantId, table.teamId),
		foreignKey({
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
	],
);

export const payrollAccessEmployee = pgTable(
	"payroll_access_employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		grantId: uuid("grant_id")
			.notNull()
			.references(() => payrollAccessGrant.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").notNull().references(() => user.id),
	},
	(table) => [
		index("payrollAccessEmployee_organizationId_idx").on(table.organizationId),
		index("payrollAccessEmployee_grantId_idx").on(table.grantId),
		index("payrollAccessEmployee_employeeId_idx").on(table.employeeId),
		uniqueIndex("payrollAccessEmployee_grant_employee_idx").on(table.grantId, table.employeeId),
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
```

Modify `apps/webapp/src/db/schema/index.ts`:

```ts
export * from "./payroll-access";
```

Add it near the existing payroll export export.

- [ ] **Step 4: Add relations**

Modify imports in `apps/webapp/src/db/schema/relations.ts` to include the new tables, then add this relation block near the payroll/export or employee relation blocks:

```ts
export const payrollAccessGrantRelations = relations(payrollAccessGrant, ({ one, many }) => ({
	organization: one(organization, {
		fields: [payrollAccessGrant.organizationId],
		references: [organization.id],
	}),
	payrollEmployee: one(employee, {
		fields: [payrollAccessGrant.payrollEmployeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [payrollAccessGrant.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [payrollAccessGrant.updatedBy],
		references: [user.id],
	}),
	teams: many(payrollAccessTeam),
	employees: many(payrollAccessEmployee),
}));

export const payrollAccessTeamRelations = relations(payrollAccessTeam, ({ one }) => ({
	grant: one(payrollAccessGrant, {
		fields: [payrollAccessTeam.grantId],
		references: [payrollAccessGrant.id],
	}),
	team: one(team, {
		fields: [payrollAccessTeam.teamId],
		references: [team.id],
	}),
	creator: one(user, {
		fields: [payrollAccessTeam.createdBy],
		references: [user.id],
	}),
}));

export const payrollAccessEmployeeRelations = relations(payrollAccessEmployee, ({ one }) => ({
	grant: one(payrollAccessGrant, {
		fields: [payrollAccessEmployee.grantId],
		references: [payrollAccessGrant.id],
	}),
	employee: one(employee, {
		fields: [payrollAccessEmployee.employeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [payrollAccessEmployee.createdBy],
		references: [user.id],
	}),
}));
```

- [ ] **Step 5: Add SQL migration**

Create `apps/webapp/drizzle/0047_scoped_payroll_access.sql`:

```sql
CREATE TABLE IF NOT EXISTS "payroll_access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"payroll_employee_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);

CREATE TABLE IF NOT EXISTS "payroll_access_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_access_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_employee_org_fk" FOREIGN KEY ("payroll_employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_grant_id_payroll_access_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "payroll_access_grant"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_team_org_fk" FOREIGN KEY ("team_id", "organization_id") REFERENCES "team"("id", "organization_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_grant_id_payroll_access_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "payroll_access_grant"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_employee_org_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "payrollAccessGrant_organizationId_idx" ON "payroll_access_grant" ("organization_id");
CREATE INDEX IF NOT EXISTS "payrollAccessGrant_payrollEmployeeId_idx" ON "payroll_access_grant" ("payroll_employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payrollAccessGrant_active_employee_idx" ON "payroll_access_grant" ("organization_id", "payroll_employee_id") WHERE is_active = true;
CREATE INDEX IF NOT EXISTS "payrollAccessTeam_organizationId_idx" ON "payroll_access_team" ("organization_id");
CREATE INDEX IF NOT EXISTS "payrollAccessTeam_grantId_idx" ON "payroll_access_team" ("grant_id");
CREATE INDEX IF NOT EXISTS "payrollAccessTeam_teamId_idx" ON "payroll_access_team" ("team_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payrollAccessTeam_grant_team_idx" ON "payroll_access_team" ("grant_id", "team_id");
CREATE INDEX IF NOT EXISTS "payrollAccessEmployee_organizationId_idx" ON "payroll_access_employee" ("organization_id");
CREATE INDEX IF NOT EXISTS "payrollAccessEmployee_grantId_idx" ON "payroll_access_employee" ("grant_id");
CREATE INDEX IF NOT EXISTS "payrollAccessEmployee_employeeId_idx" ON "payroll_access_employee" ("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payrollAccessEmployee_grant_employee_idx" ON "payroll_access_employee" ("grant_id", "employee_id");
```

- [ ] **Step 6: Update migration journal**

Modify `apps/webapp/drizzle/meta/_journal.json` by appending this entry after `0046_work_period_deletion_metadata`:

```json
{
  "idx": 47,
  "version": "7",
  "when": 1780304304748,
  "tag": "0047_scoped_payroll_access",
  "breakpoints": true
}
```

- [ ] **Step 7: Run schema tests**

Run: `pnpm --filter @z8/webapp test src/db/schema/__tests__/payroll-access-schema.test.ts src/db/schema/__tests__/approval-policy-schema.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/webapp/src/db/schema/payroll-access.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/payroll-access-schema.test.ts apps/webapp/drizzle/0047_scoped_payroll_access.sql apps/webapp/drizzle/meta/_journal.json
git commit -m "feat(payroll): add scoped access schema"
```

## Task 2: Payroll Access Permission Helpers

**Files:**
- Create: `apps/webapp/src/lib/payroll-access/permissions.ts`
- Create: `apps/webapp/src/lib/payroll-access/permissions.test.ts`

- [ ] **Step 1: Write failing permission tests**

Create `apps/webapp/src/lib/payroll-access/permissions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	intersectPayrollScope,
	resolvePayrollAccessibleEmployeeIdsFromRows,
	type PayrollAccessEmployeeRow,
	type PayrollAccessGrantRow,
	type PayrollAccessTeamMemberRow,
} from "./permissions";

const grant: PayrollAccessGrantRow = {
	id: "grant-1",
	organizationId: "org-1",
	payrollEmployeeId: "payroll-1",
	isActive: true,
};

describe("resolvePayrollAccessibleEmployeeIdsFromRows", () => {
	it("combines direct employees and current team members", () => {
		const directRows: PayrollAccessEmployeeRow[] = [
			{ employeeId: "employee-1", organizationId: "org-1", isActive: true },
		];
		const teamRows: PayrollAccessTeamMemberRow[] = [
			{ employeeId: "employee-2", organizationId: "org-1", isActive: true },
			{ employeeId: "employee-3", organizationId: "org-1", isActive: true },
		];

		expect(resolvePayrollAccessibleEmployeeIdsFromRows({ grant, directRows, teamRows })).toEqual([
			"employee-1",
			"employee-2",
			"employee-3",
		]);
	});

	it("does not include the payroll employee unless explicitly assigned", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant,
				directRows: [],
				teamRows: [{ employeeId: "employee-2", organizationId: "org-1", isActive: true }],
			}),
		).toEqual(["employee-2"]);
	});

	it("includes the payroll employee when explicitly assigned", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant,
				directRows: [{ employeeId: "payroll-1", organizationId: "org-1", isActive: true }],
				teamRows: [],
			}),
		).toEqual(["payroll-1"]);
	});

	it("filters inactive and cross-organization employees", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant,
				directRows: [
					{ employeeId: "employee-1", organizationId: "org-1", isActive: false },
					{ employeeId: "employee-2", organizationId: "org-2", isActive: true },
				],
				teamRows: [{ employeeId: "employee-3", organizationId: "org-1", isActive: true }],
			}),
		).toEqual(["employee-3"]);
	});
});

describe("intersectPayrollScope", () => {
	it("intersects requested employee ids with the allowed set", () => {
		expect(
			intersectPayrollScope({
				allowedEmployeeIds: ["employee-1", "employee-2"],
				requestedEmployeeIds: ["employee-2", "employee-3"],
			}),
		).toEqual(["employee-2"]);
	});

	it("returns all allowed employees when no employee filter is requested", () => {
		expect(
			intersectPayrollScope({
				allowedEmployeeIds: ["employee-1", "employee-2"],
			}),
		).toEqual(["employee-1", "employee-2"]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @z8/webapp test src/lib/payroll-access/permissions.test.ts`

Expected: FAIL because `permissions.ts` does not exist.

- [ ] **Step 3: Implement pure helpers and DB-backed resolver**

Create `apps/webapp/src/lib/payroll-access/permissions.ts`:

```ts
import { and, eq, inArray, or } from "drizzle-orm";
import { db, employee, payrollAccessEmployee, payrollAccessGrant, payrollAccessTeam, teamMembership } from "@/db";

export type PayrollAccessGrantRow = {
	id: string;
	organizationId: string;
	payrollEmployeeId: string;
	isActive: boolean;
};

export type PayrollAccessEmployeeRow = {
	employeeId: string;
	organizationId: string;
	isActive: boolean;
};

export type PayrollAccessTeamMemberRow = {
	employeeId: string;
	organizationId: string;
	isActive: boolean;
};

export function canManagePayrollAccess(input: { role: "admin" | "manager" | "employee" | null }): boolean {
	return input.role === "admin";
}

export function resolvePayrollAccessibleEmployeeIdsFromRows(input: {
	grant: PayrollAccessGrantRow | null;
	directRows: PayrollAccessEmployeeRow[];
	teamRows: PayrollAccessTeamMemberRow[];
}): string[] {
	if (!input.grant?.isActive) return [];

	const ids = new Set<string>();
	for (const row of [...input.directRows, ...input.teamRows]) {
		if (!row.isActive) continue;
		if (row.organizationId !== input.grant.organizationId) continue;
		ids.add(row.employeeId);
	}

	return Array.from(ids).sort();
}

export function intersectPayrollScope(input: {
	allowedEmployeeIds: string[];
	requestedEmployeeIds?: string[];
}): string[] {
	const allowed = new Set(input.allowedEmployeeIds);
	if (!input.requestedEmployeeIds?.length) return Array.from(allowed).sort();
	return input.requestedEmployeeIds.filter((id) => allowed.has(id)).sort();
}

export async function hasActivePayrollAccessGrant(input: {
	organizationId: string;
	payrollEmployeeId: string;
}): Promise<boolean> {
	const grant = await db.query.payrollAccessGrant.findFirst({
		where: and(
			eq(payrollAccessGrant.organizationId, input.organizationId),
			eq(payrollAccessGrant.payrollEmployeeId, input.payrollEmployeeId),
			eq(payrollAccessGrant.isActive, true),
		),
		columns: { id: true },
	});

	return Boolean(grant);
}

export async function resolvePayrollAccessibleEmployeeIds(input: {
	organizationId: string;
	payrollEmployeeId: string;
}): Promise<string[]> {
	const grant = await db.query.payrollAccessGrant.findFirst({
		where: and(
			eq(payrollAccessGrant.organizationId, input.organizationId),
			eq(payrollAccessGrant.payrollEmployeeId, input.payrollEmployeeId),
			eq(payrollAccessGrant.isActive, true),
		),
	});

	if (!grant) return [];

	const [directRows, teamAssignments] = await Promise.all([
		db
			.select({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
			})
			.from(payrollAccessEmployee)
			.innerJoin(employee, eq(employee.id, payrollAccessEmployee.employeeId))
			.where(and(eq(payrollAccessEmployee.grantId, grant.id), eq(payrollAccessEmployee.organizationId, input.organizationId))),
		db.query.payrollAccessTeam.findMany({
			where: and(eq(payrollAccessTeam.grantId, grant.id), eq(payrollAccessTeam.organizationId, input.organizationId)),
			columns: { teamId: true },
		}),
	]);

	const teamIds = teamAssignments.map((assignment) => assignment.teamId);
	let teamRows: PayrollAccessTeamMemberRow[] = [];

	if (teamIds.length > 0) {
		teamRows = await db
			.select({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
			})
			.from(employee)
			.leftJoin(
				teamMembership,
				and(
					eq(teamMembership.employeeId, employee.id),
					eq(teamMembership.organizationId, input.organizationId),
				),
			)
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					or(inArray(employee.teamId, teamIds), inArray(teamMembership.teamId, teamIds)),
				),
			);
	}

	return resolvePayrollAccessibleEmployeeIdsFromRows({ grant, directRows, teamRows });
}
```

- [ ] **Step 4: Run permission tests**

Run: `pnpm --filter @z8/webapp test src/lib/payroll-access/permissions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/lib/payroll-access/permissions.ts apps/webapp/src/lib/payroll-access/permissions.test.ts
git commit -m "feat(payroll): resolve scoped payroll access"
```

## Task 3: Payroll Workspace Summary Service

**Files:**
- Create: `apps/webapp/src/lib/payroll-workspace/types.ts`
- Create: `apps/webapp/src/lib/payroll-workspace/summary.ts`
- Create: `apps/webapp/src/lib/payroll-workspace/summary.test.ts`

- [ ] **Step 1: Write failing pure summary tests**

Create `apps/webapp/src/lib/payroll-workspace/summary.test.ts`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildPayrollSummaryFromRows } from "./summary";

describe("buildPayrollSummaryFromRows", () => {
	it("returns total worked hours per employee", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{ id: "employee-1", name: "Ada Lovelace", employeeNumber: "E-1", teamName: "Ops", contractType: "hourly" },
			],
			workRows: [
				{ employeeId: "employee-1", durationMinutes: 120 },
				{ employeeId: "employee-1", durationMinutes: 45 },
			],
			absenceRows: [],
			blockers: [],
		});

		expect(summary.totals.totalWorkedHours).toBe(2.75);
		expect(summary.employees[0]?.workedHours).toBe(2.75);
	});

	it("groups absence days by employee and category", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{ id: "employee-1", name: "Ada Lovelace", employeeNumber: "E-1", teamName: "Ops", contractType: "fixed" },
			],
			workRows: [],
			absenceRows: [
				{ employeeId: "employee-1", categoryId: "vacation", categoryName: "Vacation", days: 2 },
				{ employeeId: "employee-1", categoryId: "sick", categoryName: "Sick", days: 1 },
			],
			blockers: [],
		});

		expect(summary.employees[0]?.absenceDaysByCategory).toEqual([
			{ categoryId: "sick", categoryName: "Sick", days: 1 },
			{ categoryId: "vacation", categoryName: "Vacation", days: 2 },
		]);
	});

	it("keeps blockers as warnings and marks affected employees", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{ id: "employee-1", name: "Ada Lovelace", employeeNumber: "E-1", teamName: "Ops", contractType: "hourly" },
			],
			workRows: [],
			absenceRows: [],
			blockers: [{ id: "blocker-1", employeeId: "employee-1", type: "missing_clock_out", label: "Missing clock-out" }],
		});

		expect(summary.totals.blockerCount).toBe(1);
		expect(summary.employees[0]?.hasBlockers).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @z8/webapp test src/lib/payroll-workspace/summary.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define workspace types**

Create `apps/webapp/src/lib/payroll-workspace/types.ts`:

```ts
import type { DateTime } from "luxon";

export type PayrollDateRangeMode = "month" | "week" | "custom";

export type PayrollPeriod = {
	start: string;
	end: string;
	label: string;
};

export type PayrollSummaryEmployeeSource = {
	id: string;
	name: string;
	employeeNumber: string | null;
	teamName: string | null;
	contractType: "fixed" | "hourly";
};

export type PayrollSummaryWorkRow = {
	employeeId: string;
	durationMinutes: number | null;
};

export type PayrollSummaryAbsenceRow = {
	employeeId: string;
	categoryId: string;
	categoryName: string;
	days: number;
};

export type PayrollBlockerType = "missing_clock_out" | "pending_absence" | "pending_time_correction";

export type PayrollBlocker = {
	id: string;
	employeeId: string;
	type: PayrollBlockerType;
	label: string;
};

export type PayrollEmployeeSummary = PayrollSummaryEmployeeSource & {
	workedHours: number;
	absenceDaysByCategory: Array<{ categoryId: string; categoryName: string; days: number }>;
	hasBlockers: boolean;
};

export type PayrollWorkspaceSummary = {
	organizationName: string;
	period: PayrollPeriod;
	generatedAt: DateTime;
	generatedBy: { id: string; name: string };
	totals: {
		employeeCount: number;
		totalWorkedHours: number;
		blockerCount: number;
	};
	employees: PayrollEmployeeSummary[];
	blockers: PayrollBlocker[];
};
```

- [ ] **Step 4: Implement pure summary builder and DB entry point**

Create `apps/webapp/src/lib/payroll-workspace/summary.ts`:

```ts
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, employee, organization, team, timeRecord } from "@/db";
import type {
	PayrollBlocker,
	PayrollSummaryAbsenceRow,
	PayrollSummaryEmployeeSource,
	PayrollSummaryWorkRow,
	PayrollWorkspaceSummary,
} from "./types";

function roundHours(minutes: number): number {
	return Math.round((minutes / 60) * 100) / 100;
}

export function buildPayrollSummaryFromRows(input: {
	organizationName: string;
	period: PayrollWorkspaceSummary["period"];
	generatedAt: DateTime;
	generatedBy: PayrollWorkspaceSummary["generatedBy"];
	employees: PayrollSummaryEmployeeSource[];
	workRows: PayrollSummaryWorkRow[];
	absenceRows: PayrollSummaryAbsenceRow[];
	blockers: PayrollBlocker[];
}): PayrollWorkspaceSummary {
	const workMinutesByEmployee = new Map<string, number>();
	for (const row of input.workRows) {
		workMinutesByEmployee.set(row.employeeId, (workMinutesByEmployee.get(row.employeeId) ?? 0) + (row.durationMinutes ?? 0));
	}

	const absenceByEmployee = new Map<string, Map<string, { categoryId: string; categoryName: string; days: number }>>();
	for (const row of input.absenceRows) {
		const categories = absenceByEmployee.get(row.employeeId) ?? new Map();
		const existing = categories.get(row.categoryId) ?? {
			categoryId: row.categoryId,
			categoryName: row.categoryName,
			days: 0,
		};
		existing.days += row.days;
		categories.set(row.categoryId, existing);
		absenceByEmployee.set(row.employeeId, categories);
	}

	const blockerEmployeeIds = new Set(input.blockers.map((blocker) => blocker.employeeId));
	const employees = input.employees
		.map((emp) => ({
			...emp,
			workedHours: roundHours(workMinutesByEmployee.get(emp.id) ?? 0),
			absenceDaysByCategory: Array.from(absenceByEmployee.get(emp.id)?.values() ?? []).sort((a, b) =>
				a.categoryName.localeCompare(b.categoryName),
			),
			hasBlockers: blockerEmployeeIds.has(emp.id),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		organizationName: input.organizationName,
		period: input.period,
		generatedAt: input.generatedAt,
		generatedBy: input.generatedBy,
		totals: {
			employeeCount: employees.length,
			totalWorkedHours: roundHours(input.workRows.reduce((sum, row) => sum + (row.durationMinutes ?? 0), 0)),
			blockerCount: input.blockers.length,
		},
		employees,
		blockers: input.blockers,
	};
}

export async function getPayrollWorkspaceSummary(input: {
	organizationId: string;
	allowedEmployeeIds: string[];
	period: { start: DateTime; end: DateTime; label: string };
	generatedBy: { id: string; name: string };
}): Promise<PayrollWorkspaceSummary> {
	if (input.allowedEmployeeIds.length === 0) {
		const org = await db.query.organization.findFirst({ where: eq(organization.id, input.organizationId) });
		return buildPayrollSummaryFromRows({
			organizationName: org?.name ?? "Organization",
			period: { start: input.period.start.toISODate() ?? "", end: input.period.end.toISODate() ?? "", label: input.period.label },
			generatedAt: DateTime.utc(),
			generatedBy: input.generatedBy,
			employees: [],
			workRows: [],
			absenceRows: [],
			blockers: [],
		});
	}

	const start = input.period.start.startOf("day");
	const end = input.period.end.endOf("day");
	const [org, employeeRows, workRows, absenceRows, activeWorkRecords, pendingAbsenceRows, pendingCorrectionRows] = await Promise.all([
		db.query.organization.findFirst({ where: eq(organization.id, input.organizationId) }),
		db
			.select({
				id: employee.id,
				name: employee.firstName,
				lastName: employee.lastName,
				employeeNumber: employee.employeeNumber,
				teamName: team.name,
				contractType: employee.contractType,
			})
			.from(employee)
			.leftJoin(team, eq(team.id, employee.teamId))
			.where(and(eq(employee.organizationId, input.organizationId), inArray(employee.id, input.allowedEmployeeIds), eq(employee.isActive, true))),
		db.query.timeRecord.findMany({
			where: and(
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.approvalState, "approved"),
				inArray(timeRecord.employeeId, input.allowedEmployeeIds),
				gte(timeRecord.startAt, start.toJSDate()),
				lte(timeRecord.startAt, end.toJSDate()),
			),
			columns: { employeeId: true, durationMinutes: true },
		}),
		db.query.timeRecord.findMany({
			where: and(
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "absence"),
				eq(timeRecord.approvalState, "approved"),
				inArray(timeRecord.employeeId, input.allowedEmployeeIds),
				lte(timeRecord.startAt, end.toJSDate()),
				or(gte(timeRecord.endAt, start.toJSDate()), isNull(timeRecord.endAt)),
			),
			with: { absence: { with: { absenceCategory: true } } },
		}),
		db.query.timeRecord.findMany({
			where: and(eq(timeRecord.organizationId, input.organizationId), eq(timeRecord.recordKind, "work"), inArray(timeRecord.employeeId, input.allowedEmployeeIds), isNull(timeRecord.endAt)),
			columns: { id: true, employeeId: true },
		}),
		db.query.timeRecord.findMany({
			where: and(eq(timeRecord.organizationId, input.organizationId), eq(timeRecord.recordKind, "absence"), eq(timeRecord.approvalState, "pending"), inArray(timeRecord.employeeId, input.allowedEmployeeIds)),
			columns: { id: true, employeeId: true },
		}),
		db.query.approvalRequest.findMany({
			where: and(eq(approvalRequest.organizationId, input.organizationId), eq(approvalRequest.status, "pending"), inArray(approvalRequest.requestedBy, input.allowedEmployeeIds)),
			columns: { id: true, requestedBy: true, title: true },
		}),
	]);

	const blockers: PayrollBlocker[] = [
		...activeWorkRecords.map((row) => ({ id: row.id, employeeId: row.employeeId, type: "missing_clock_out" as const, label: "Missing clock-out" })),
		...pendingAbsenceRows.map((row) => ({ id: row.id, employeeId: row.employeeId, type: "pending_absence" as const, label: "Pending absence approval" })),
		...pendingCorrectionRows.map((row) => ({ id: row.id, employeeId: row.requestedBy, type: "pending_time_correction" as const, label: row.title ?? "Pending time correction" })),
	];

	return buildPayrollSummaryFromRows({
		organizationName: org?.name ?? "Organization",
		period: { start: start.toISODate() ?? "", end: end.toISODate() ?? "", label: input.period.label },
		generatedAt: DateTime.utc(),
		generatedBy: input.generatedBy,
		employees: employeeRows.map((row) => ({
			id: row.id,
			name: [row.name, row.lastName].filter(Boolean).join(" ") || row.employeeNumber || row.id,
			employeeNumber: row.employeeNumber,
			teamName: row.teamName,
			contractType: row.contractType,
		})),
		workRows,
		absenceRows: absenceRows.map((row) => ({
			employeeId: row.employeeId,
			categoryId: row.absence?.absenceCategoryId ?? "uncategorized",
			categoryName: row.absence?.absenceCategory?.name ?? "Uncategorized",
			days: Math.max(1, Math.ceil(DateTime.fromJSDate(row.endAt ?? row.startAt).diff(DateTime.fromJSDate(row.startAt), "days").days)),
		})),
		blockers,
	});
}
```

If `approvalRequest` is not already imported from `@/db`, add it to the import list. If its status/type fields differ, adapt the pending time-correction query to the actual approval schema while keeping the testable blocker type output.

- [ ] **Step 5: Run summary tests**

Run: `pnpm --filter @z8/webapp test src/lib/payroll-workspace/summary.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/lib/payroll-workspace/types.ts apps/webapp/src/lib/payroll-workspace/summary.ts apps/webapp/src/lib/payroll-workspace/summary.test.ts
git commit -m "feat(payroll): build scoped payroll summary"
```

## Task 4: Combined Payroll PDF Exporter

**Files:**
- Create: `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx`
- Create: `apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx`

- [ ] **Step 1: Write failing PDF tests**

Create `apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { exportPayrollSummaryToPDF, generatePayrollPDFFilename } from "./pdf-exporter";
import type { PayrollWorkspaceSummary } from "./types";

const summary: PayrollWorkspaceSummary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 1, totalWorkedHours: 12.5, blockerCount: 1 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 12.5,
			absenceDaysByCategory: [{ categoryId: "vacation", categoryName: "Vacation", days: 2 }],
			hasBlockers: true,
		},
	],
	blockers: [{ id: "blocker-1", employeeId: "employee-1", type: "missing_clock_out", label: "Missing clock-out" }],
};

describe("payroll PDF exporter", () => {
	it("generates a stable filename", () => {
		expect(generatePayrollPDFFilename(summary)).toBe("payroll-acme-gmbh-2026-06-01-2026-06-30.pdf");
	});

	it("generates a PDF byte array", async () => {
		const pdf = await exportPayrollSummaryToPDF(summary);
		expect(pdf.byteLength).toBeGreaterThan(1000);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @z8/webapp test src/lib/payroll-workspace/pdf-exporter.test.tsx`

Expected: FAIL because `pdf-exporter.tsx` does not exist.

- [ ] **Step 3: Implement PDF exporter**

Create `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx`:

```tsx
import type { PayrollWorkspaceSummary } from "./types";

const styles = {
	page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
	header: { marginBottom: 18, borderBottomWidth: 1, borderBottomColor: "#dbeafe", paddingBottom: 12 },
	title: { fontSize: 20, fontWeight: "bold", color: "#1d4ed8" },
	subtitle: { marginTop: 4, color: "#475569" },
	metricRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
	metric: { flex: 1, padding: 10, backgroundColor: "#eff6ff", borderRadius: 6 },
	metricLabel: { color: "#475569", marginBottom: 3 },
	metricValue: { fontSize: 14, fontWeight: "bold" },
	sectionTitle: { fontSize: 12, fontWeight: "bold", marginTop: 12, marginBottom: 6 },
	tableHeader: { flexDirection: "row", backgroundColor: "#1d4ed8", color: "#ffffff", padding: 6, fontWeight: "bold" },
	tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", padding: 6 },
	cellName: { flex: 2 },
	cell: { flex: 1 },
	warning: { padding: 8, backgroundColor: "#fffbeb", borderColor: "#f59e0b", borderWidth: 1, marginBottom: 8 },
	footer: { position: "absolute", bottom: 20, left: 32, right: 32, textAlign: "center", fontSize: 8, color: "#64748b" },
} as const;

function formatHours(hours: number): string {
	return `${hours.toFixed(2)} h`;
}

function formatAbsences(employee: PayrollWorkspaceSummary["employees"][number]): string {
	if (employee.absenceDaysByCategory.length === 0) return "-";
	return employee.absenceDaysByCategory.map((entry) => `${entry.categoryName}: ${entry.days}d`).join(", ");
}

export async function exportPayrollSummaryToPDF(summary: PayrollWorkspaceSummary): Promise<Uint8Array> {
	const { Document, Page, Text, View, pdf, StyleSheet } = await import("@react-pdf/renderer");
	const pdfStyles = StyleSheet.create(styles);

	const PayrollDocument = () => (
		<Document>
			<Page size="A4" style={pdfStyles.page}>
				<View style={pdfStyles.header}>
					<Text style={pdfStyles.title}>Payroll Summary</Text>
					<Text style={pdfStyles.subtitle}>{summary.organizationName}</Text>
					<Text style={pdfStyles.subtitle}>Period: {summary.period.label}</Text>
					<Text style={pdfStyles.subtitle}>Generated by {summary.generatedBy.name} on {summary.generatedAt.toFormat("yyyy-LL-dd HH:mm 'UTC'")}</Text>
				</View>

				<View style={pdfStyles.metricRow}>
					<View style={pdfStyles.metric}><Text style={pdfStyles.metricLabel}>Employees</Text><Text style={pdfStyles.metricValue}>{summary.totals.employeeCount}</Text></View>
					<View style={pdfStyles.metric}><Text style={pdfStyles.metricLabel}>Worked hours</Text><Text style={pdfStyles.metricValue}>{formatHours(summary.totals.totalWorkedHours)}</Text></View>
					<View style={pdfStyles.metric}><Text style={pdfStyles.metricLabel}>Blockers</Text><Text style={pdfStyles.metricValue}>{summary.totals.blockerCount}</Text></View>
				</View>

				{summary.blockers.length > 0 && (
					<View style={pdfStyles.warning}>
						<Text>Warnings were present for this payroll period. Export was allowed to proceed.</Text>
						{summary.blockers.map((blocker) => <Text key={blocker.id}>- {blocker.label}</Text>)}
					</View>
				)}

				<Text style={pdfStyles.sectionTitle}>Employee Totals</Text>
				<View style={pdfStyles.tableHeader}>
					<Text style={pdfStyles.cellName}>Employee</Text>
					<Text style={pdfStyles.cell}>Team</Text>
					<Text style={pdfStyles.cell}>Contract</Text>
					<Text style={pdfStyles.cell}>Hours</Text>
					<Text style={pdfStyles.cellName}>Absences</Text>
				</View>
				{summary.employees.map((employee) => (
					<View key={employee.id} style={pdfStyles.tableRow}>
						<Text style={pdfStyles.cellName}>{employee.name}{employee.employeeNumber ? ` (${employee.employeeNumber})` : ""}</Text>
						<Text style={pdfStyles.cell}>{employee.teamName ?? "-"}</Text>
						<Text style={pdfStyles.cell}>{employee.contractType}</Text>
						<Text style={pdfStyles.cell}>{formatHours(employee.workedHours)}</Text>
						<Text style={pdfStyles.cellName}>{formatAbsences(employee)}</Text>
					</View>
				))}

				<Text style={pdfStyles.footer}>Z8 payroll export. Blockers are informational and did not prevent export.</Text>
			</Page>
		</Document>
	);

	const blob = await pdf(<PayrollDocument />).toBlob();
	return new Uint8Array(await blob.arrayBuffer());
}

export function generatePayrollPDFFilename(summary: PayrollWorkspaceSummary): string {
	const orgSlug = summary.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "organization";
	return `payroll-${orgSlug}-${summary.period.start}-${summary.period.end}.pdf`;
}
```

- [ ] **Step 4: Run PDF tests**

Run: `pnpm --filter @z8/webapp test src/lib/payroll-workspace/pdf-exporter.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx
git commit -m "feat(payroll): add combined PDF export"
```

## Task 5: Payroll Workspace Server Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`

- [ ] **Step 1: Write scope-focused action tests**

Create `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payroll-access/permissions", () => ({
	intersectPayrollScope: vi.fn(({ allowedEmployeeIds, requestedEmployeeIds }) =>
		requestedEmployeeIds?.length ? requestedEmployeeIds.filter((id: string) => allowedEmployeeIds.includes(id)) : allowedEmployeeIds,
	),
	resolvePayrollAccessibleEmployeeIds: vi.fn(async () => ["employee-1", "employee-2"]),
}));

describe("payroll actions scope", () => {
	it("documents required scope intersection for requested employees", async () => {
		const { intersectPayrollScope } = await import("@/lib/payroll-access/permissions");
		expect(intersectPayrollScope({ allowedEmployeeIds: ["employee-1", "employee-2"], requestedEmployeeIds: ["employee-2", "employee-3"] })).toEqual(["employee-2"]);
	});
});
```

This test is intentionally minimal because the full server actions depend on session and Effect layers. The key behavioral coverage remains in `permissions.test.ts`; this file prevents future action code from bypassing the scope helper.

- [ ] **Step 2: Run action test**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/payroll/actions.test.ts'`

Expected: PASS after imports resolve; if the path does not exist yet, create the directory first and rerun.

- [ ] **Step 3: Implement server actions**

Create `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`:

```ts
"use server";

import { DateTime } from "luxon";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAuthContext } from "@/lib/auth-helpers";
import { getDatevConfigAction, getLexwareConfigAction, getSageConfigAction } from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthorizationError } from "@/lib/effect/errors";
import { intersectPayrollScope, resolvePayrollAccessibleEmployeeIds } from "@/lib/payroll-access/permissions";
import { createExportJob, processExportJob, type PayrollExportFilters } from "@/lib/payroll-export";
import { exportPayrollSummaryToPDF, generatePayrollPDFFilename } from "@/lib/payroll-workspace/pdf-exporter";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";

export type PayrollWorkspaceRequest = {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
};

export type PayrollExportFormatOption = {
	id: string;
	label: string;
};

async function requirePayrollActor() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) throw new Error("Authentication required");
	const context = await getAuthContext();
	if (!context?.employee || !context.session.activeOrganizationId) throw new Error("Employee context required");
	return { context, organizationId: context.session.activeOrganizationId, employee: context.employee, user: context.user };
}

async function resolveScopedEmployees(input: { organizationId: string; currentEmployeeId: string; role: "admin" | "manager" | "employee"; requestedEmployeeIds?: string[] }) {
	if (input.role === "admin") return input.requestedEmployeeIds;
	const allowedEmployeeIds = await resolvePayrollAccessibleEmployeeIds({ organizationId: input.organizationId, payrollEmployeeId: input.currentEmployeeId });
	return intersectPayrollScope({ allowedEmployeeIds, requestedEmployeeIds: input.requestedEmployeeIds });
}

export async function getPayrollWorkspaceSummaryAction(request: PayrollWorkspaceRequest): Promise<ServerActionResult<PayrollWorkspaceSummary>> {
	return runServerActionSafe(async () => {
		const actor = await requirePayrollActor();
		const scopedEmployeeIds = await resolveScopedEmployees({
			organizationId: actor.organizationId,
			currentEmployeeId: actor.employee.id,
			role: actor.employee.role,
			requestedEmployeeIds: request.employeeIds,
		});

		if (actor.employee.role !== "admin" && scopedEmployeeIds.length === 0) {
			throw new AuthorizationError({ message: "No payroll employees assigned" });
		}

		return getPayrollWorkspaceSummary({
			organizationId: actor.organizationId,
			allowedEmployeeIds: scopedEmployeeIds ?? [],
			period: { start: DateTime.fromISO(request.startDate), end: DateTime.fromISO(request.endDate), label: request.label },
			generatedBy: { id: actor.employee.id, name: actor.user.name ?? actor.user.email },
		});
	});
}

export async function getConfiguredPayrollExportFormatsAction(): Promise<ServerActionResult<PayrollExportFormatOption[]>> {
	return runServerActionSafe(async () => {
		const actor = await requirePayrollActor();
		const [datev, lexware, sage] = await Promise.all([
			getDatevConfigAction(actor.organizationId),
			getLexwareConfigAction(actor.organizationId),
			getSageConfigAction(actor.organizationId),
		]);
		const formats: PayrollExportFormatOption[] = [];
		if (datev.success && datev.data) formats.push({ id: "datev_lohn", label: "DATEV" });
		if (lexware.success && lexware.data) formats.push({ id: "lexware_lohn", label: "Lexware" });
		if (sage.success && sage.data) formats.push({ id: "sage_lohn", label: "Sage" });
		return formats;
	});
}

export async function exportPayrollPdfAction(request: PayrollWorkspaceRequest): Promise<ServerActionResult<{ filename: string; data: number[] }>> {
	return runServerActionSafe(async () => {
		const summaryResult = await getPayrollWorkspaceSummaryAction(request);
		if (!summaryResult.success) throw new Error(summaryResult.error);
		const data = await exportPayrollSummaryToPDF(summaryResult.data);
		return { filename: generatePayrollPDFFilename(summaryResult.data), data: Array.from(data) };
	});
}

export async function startScopedPayrollExportAction(request: PayrollWorkspaceRequest & { formatId: string }): Promise<ServerActionResult<{ jobId: string; isAsync: boolean; fileContent?: string }>> {
	return runServerActionSafe(async () => {
		const actor = await requirePayrollActor();
		const scopedEmployeeIds = await resolveScopedEmployees({
			organizationId: actor.organizationId,
			currentEmployeeId: actor.employee.id,
			role: actor.employee.role,
			requestedEmployeeIds: request.employeeIds,
		});

		if (actor.employee.role !== "admin" && scopedEmployeeIds.length === 0) {
			throw new AuthorizationError({ message: "No payroll employees assigned" });
		}

		const filters: PayrollExportFilters = {
			dateRange: { start: DateTime.fromISO(request.startDate), end: DateTime.fromISO(request.endDate) },
			employeeIds: scopedEmployeeIds,
		};
		const { jobId, isAsync } = await createExportJob({ organizationId: actor.organizationId, formatId: request.formatId, requestedById: actor.employee.id, filters });
		if (isAsync) return { jobId, isAsync };
		const { result } = await processExportJob(jobId);
		return { jobId, isAsync, fileContent: typeof result?.content === "string" ? result.content : result?.content?.toString("utf-8") };
	});
}
```

If `runServerActionSafe` only accepts Effect values in the current project version, wrap each async body with `Effect.promise` and `Effect.provide(AppLayer)` following `settings/payroll-export/actions.ts`.

- [ ] **Step 4: Run action tests and typecheck targeted files**

Run: `pnpm --filter @z8/webapp test 'src/app/[locale]/(app)/payroll/actions.test.ts'`

Expected: PASS.

Run: `pnpm --filter @z8/webapp exec tsc --noEmit --pretty false`

Expected: PASS or only pre-existing unrelated errors. If this task introduces errors, fix them before continuing.

- [ ] **Step 5: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/payroll/actions.ts' 'apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts'
git commit -m "feat(payroll): add scoped workspace actions"
```

## Task 6: Payroll Workspace UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/page.tsx`
- Create: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Create: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { PayrollWorkspace } from "./payroll-workspace";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const summary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 1, totalWorkedHours: 8, blockerCount: 1 },
	employees: [{ id: "employee-1", name: "Ada Lovelace", employeeNumber: "E-1", teamName: "Ops", contractType: "hourly", workedHours: 8, absenceDaysByCategory: [], hasBlockers: true }],
	blockers: [{ id: "blocker-1", employeeId: "employee-1", type: "missing_clock_out", label: "Missing clock-out" }],
} as const;

describe("PayrollWorkspace", () => {
	it("renders summary cards, employee rows, and blockers", () => {
		render(<PayrollWorkspace initialSummary={summary} exportFormats={[{ id: "datev_lohn", label: "DATEV" }]} />);
		expect(screen.getByText("Payroll")).toBeTruthy();
		expect(screen.getByText("8.00 h")).toBeTruthy();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Missing clock-out")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run UI test to verify it fails**

Run: `pnpm --filter @z8/webapp test src/components/payroll/payroll-workspace.test.tsx`

Expected: FAIL because `payroll-workspace.tsx` does not exist.

- [ ] **Step 3: Implement client workspace**

Create `apps/webapp/src/components/payroll/payroll-workspace.tsx`:

```tsx
"use client";

import { IconAlertTriangle, IconDownload, IconFileExport } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportPayrollPdfAction, getPayrollWorkspaceSummaryAction, startScopedPayrollExportAction } from "@/app/[locale]/(app)/payroll/actions";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";

export function PayrollWorkspace({ initialSummary, exportFormats }: { initialSummary: PayrollWorkspaceSummary; exportFormats: Array<{ id: string; label: string }> }) {
	const { t } = useTranslate();
	const [summary, setSummary] = useState(initialSummary);
	const [dateMode, setDateMode] = useState<"month" | "week" | "custom">("month");
	const [startDate, setStartDate] = useState(summary.period.start);
	const [endDate, setEndDate] = useState(summary.period.end);
	const [formatId, setFormatId] = useState(exportFormats[0]?.id ?? "datev_lohn");
	const [isPending, startTransition] = useTransition();

	const refreshSummary = (nextStartDate = startDate, nextEndDate = endDate, nextLabel = `${nextStartDate} - ${nextEndDate}`) => {
		startTransition(async () => {
			const result = await getPayrollWorkspaceSummaryAction({ startDate: nextStartDate, endDate: nextEndDate, label: nextLabel });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			setSummary(result.data);
		});
	};

	const applyDateMode = (mode: "month" | "week" | "custom") => {
		setDateMode(mode);
		if (mode === "custom") return;
		const now = DateTime.now();
		const start = now.startOf(mode).toISODate() ?? startDate;
		const end = now.endOf(mode).toISODate() ?? endDate;
		setStartDate(start);
		setEndDate(end);
		refreshSummary(start, end, mode === "month" ? now.toFormat("LLLL yyyy") : `Week ${now.weekNumber}, ${now.weekYear}`);
	};

	const downloadPdf = () => {
		startTransition(async () => {
			const result = await exportPayrollPdfAction({ startDate: summary.period.start, endDate: summary.period.end, label: summary.period.label });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			const blob = new Blob([new Uint8Array(result.data.data)], { type: "application/pdf" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = result.data.filename;
			link.click();
			URL.revokeObjectURL(url);
		});
	};

	const triggerExport = () => {
		startTransition(async () => {
			const result = await startScopedPayrollExportAction({ startDate: summary.period.start, endDate: summary.period.end, label: summary.period.label, formatId });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(result.data.isAsync ? t("payroll.export.started", "Export started") : t("payroll.export.downloaded", "Export ready"));
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">{t("payroll.title", "Payroll")}</h1>
				<p className="text-muted-foreground">{summary.period.label}</p>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card><CardHeader><CardTitle>{t("payroll.metrics.employees", "Employees")}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.totals.employeeCount}</CardContent></Card>
				<Card><CardHeader><CardTitle>{t("payroll.metrics.hours", "Worked hours")}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.totals.totalWorkedHours.toFixed(2)} h</CardContent></Card>
				<Card><CardHeader><CardTitle>{t("payroll.metrics.blockers", "Blockers")}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.totals.blockerCount}</CardContent></Card>
			</div>

			<Card>
				<CardHeader><CardTitle>{t("payroll.filters.period", "Period")}</CardTitle></CardHeader>
				<CardContent className="flex flex-wrap items-end gap-3">
					<Select value={dateMode} onValueChange={(value) => applyDateMode(value as "month" | "week" | "custom")}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="month">Month</SelectItem><SelectItem value="week">Week</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectContent></Select>
					<input className="rounded-md border px-3 py-2" type="date" value={startDate} disabled={dateMode !== "custom"} onChange={(event) => setStartDate(event.target.value)} />
					<input className="rounded-md border px-3 py-2" type="date" value={endDate} disabled={dateMode !== "custom"} onChange={(event) => setEndDate(event.target.value)} />
					<Button variant="outline" onClick={() => refreshSummary()} disabled={isPending || dateMode !== "custom"}>{t("payroll.filters.apply", "Apply")}</Button>
				</CardContent>
			</Card>

			{summary.blockers.length > 0 && (
				<Card className="border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20">
					<CardHeader><CardTitle className="flex items-center gap-2"><IconAlertTriangle className="size-5" />{t("payroll.blockers.title", "Blockers")}</CardTitle></CardHeader>
					<CardContent className="space-y-1">{summary.blockers.map((blocker) => <p key={blocker.id}>{blocker.label}</p>)}</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader><CardTitle>{t("payroll.employees.title", "Employee totals")}</CardTitle></CardHeader>
				<CardContent className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead><tr className="border-b text-left"><th className="py-2">Employee</th><th>Team</th><th>Contract</th><th>Hours</th><th>Absences</th><th>Status</th></tr></thead>
						<tbody>{summary.employees.map((employee) => <tr key={employee.id} className="border-b"><td className="py-2 font-medium">{employee.name}</td><td>{employee.teamName ?? "-"}</td><td>{employee.contractType}</td><td>{employee.workedHours.toFixed(2)} h</td><td>{employee.absenceDaysByCategory.map((entry) => `${entry.categoryName}: ${entry.days}d`).join(", ") || "-"}</td><td>{employee.hasBlockers ? "Warning" : "Ready"}</td></tr>)}</tbody>
					</table>
				</CardContent>
			</Card>

			<div className="flex flex-wrap items-center gap-3">
				<Button onClick={downloadPdf} disabled={isPending}><IconDownload className="mr-2 size-4" />{t("payroll.export.pdf", "Download combined PDF")}</Button>
				<Select value={formatId} onValueChange={setFormatId}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent>{exportFormats.map((format) => <SelectItem key={format.id} value={format.id}>{format.label}</SelectItem>)}</SelectContent></Select>
				<Button variant="outline" onClick={triggerExport} disabled={isPending || exportFormats.length === 0}><IconFileExport className="mr-2 size-4" />{t("payroll.export.system", "Trigger payroll export")}</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Implement server page**

Create `apps/webapp/src/app/[locale]/(app)/payroll/page.tsx`:

```tsx
import { connection } from "next/server";
import { DateTime } from "luxon";
import { PayrollWorkspace } from "@/components/payroll/payroll-workspace";
import { getConfiguredPayrollExportFormatsAction, getPayrollWorkspaceSummaryAction } from "./actions";

export default async function PayrollPage() {
	await connection();
	const now = DateTime.now();
	const [result, formatsResult] = await Promise.all([getPayrollWorkspaceSummaryAction({
		startDate: now.startOf("month").toISODate() ?? "",
		endDate: now.endOf("month").toISODate() ?? "",
		label: now.toFormat("LLLL yyyy"),
	}), getConfiguredPayrollExportFormatsAction()]);

	if (!result.success) {
		return <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">No payroll access is assigned.</div>;
	}

	return <PayrollWorkspace initialSummary={result.data} exportFormats={formatsResult.success ? formatsResult.data : []} />;
}
```

- [ ] **Step 5: Run UI tests**

Run: `pnpm --filter @z8/webapp test src/components/payroll/payroll-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/payroll/page.tsx' apps/webapp/src/components/payroll/payroll-workspace.tsx apps/webapp/src/components/payroll/payroll-workspace.test.tsx
git commit -m "feat(payroll): add payroll workspace UI"
```

## Task 7: Admin Payroll Access Assignment Page

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx`
- Create: `apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx`
- Create: `apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx`

- [ ] **Step 1: Write form render test**

Create `apps/webapp/src/components/settings/payroll-access/payroll-access-form.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PayrollAccessForm } from "./payroll-access-form";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

describe("PayrollAccessForm", () => {
	it("renders payroll employee, team, and employee selectors", () => {
		render(
			<PayrollAccessForm
				employees={[{ id: "employee-1", name: "Ada Lovelace" }]}
				teams={[{ id: "team-1", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		expect(screen.getByText("Payroll access")).toBeTruthy();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Ops")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run form test to verify it fails**

Run: `pnpm --filter @z8/webapp test src/components/settings/payroll-access/payroll-access-form.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement admin actions**

Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/actions.ts`:

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, employee, payrollAccessEmployee, payrollAccessGrant, payrollAccessTeam, team } from "@/db";
import { requireAdmin } from "@/lib/auth-helpers";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";

export type SavePayrollAccessInput = {
	payrollEmployeeId: string;
	teamIds: string[];
	employeeIds: string[];
};

export async function getPayrollAccessAdminDataAction(): Promise<ServerActionResult<{ employees: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }>; grants: Array<{ id: string; payrollEmployeeId: string; teamIds: string[]; employeeIds: string[] }> }>> {
	return runServerActionSafe(async () => {
		const context = await requireAdmin();
		const organizationId = context.employee!.organizationId;
		const [employees, teams, grants] = await Promise.all([
			db.query.employee.findMany({ where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)), with: { user: true } }),
			db.query.team.findMany({ where: eq(team.organizationId, organizationId) }),
			db.query.payrollAccessGrant.findMany({ where: and(eq(payrollAccessGrant.organizationId, organizationId), eq(payrollAccessGrant.isActive, true)), with: { teams: true, employees: true } }),
		]);

		return {
			employees: employees.map((emp) => ({ id: emp.id, name: emp.user?.name ?? [emp.firstName, emp.lastName].filter(Boolean).join(" ") || emp.employeeNumber || emp.id })),
			teams: teams.map((team) => ({ id: team.id, name: team.name })),
			grants: grants.map((grant) => ({ id: grant.id, payrollEmployeeId: grant.payrollEmployeeId, teamIds: grant.teams.map((row) => row.teamId), employeeIds: grant.employees.map((row) => row.employeeId) })),
		};
	});
}

export async function savePayrollAccessAction(input: SavePayrollAccessInput): Promise<ServerActionResult<{ grantId: string }>> {
	return runServerActionSafe(async () => {
		const context = await requireAdmin();
		const organizationId = context.employee!.organizationId;
		const [grant] = await db
			.insert(payrollAccessGrant)
			.values({ organizationId, payrollEmployeeId: input.payrollEmployeeId, createdBy: context.user.id, updatedBy: context.user.id })
			.onConflictDoUpdate({ target: [payrollAccessGrant.organizationId, payrollAccessGrant.payrollEmployeeId], set: { isActive: true, updatedBy: context.user.id } })
			.returning();

		await Promise.all([
			db.delete(payrollAccessTeam).where(eq(payrollAccessTeam.grantId, grant.id)),
			db.delete(payrollAccessEmployee).where(eq(payrollAccessEmployee.grantId, grant.id)),
		]);
		if (input.teamIds.length > 0) {
			await db.insert(payrollAccessTeam).values(input.teamIds.map((teamId) => ({ organizationId, grantId: grant.id, teamId, createdBy: context.user.id })));
		}
		if (input.employeeIds.length > 0) {
			await db.insert(payrollAccessEmployee).values(input.employeeIds.map((employeeId) => ({ organizationId, grantId: grant.id, employeeId, createdBy: context.user.id })));
		}

		revalidatePath("/settings/payroll-access");
		return { grantId: grant.id };
	});
}
```

If Drizzle cannot infer `onConflictDoUpdate` for the partial active unique index, replace it with a query for the active grant followed by insert or update.

- [ ] **Step 4: Implement form**

Create `apps/webapp/src/components/settings/payroll-access/payroll-access-form.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { savePayrollAccessAction } from "@/app/[locale]/(app)/settings/payroll-access/actions";

type Option = { id: string; name: string };

export function PayrollAccessForm({ employees, teams, initialGrants }: { employees: Option[]; teams: Option[]; initialGrants: Array<{ id: string; payrollEmployeeId: string; teamIds: string[]; employeeIds: string[] }> }) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { payrollEmployeeId: employees[0]?.id ?? "", teamIds: [] as string[], employeeIds: [] as string[] },
		onSubmit: async ({ value }) => { await savePayrollAccessAction(value); },
	});

	return (
		<Card>
			<CardHeader><CardTitle>{t("settings.payrollAccess.title", "Payroll access")}</CardTitle></CardHeader>
			<CardContent className="space-y-4">
				<form onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }} className="space-y-4">
					<form.Field name="payrollEmployeeId">{(field) => <select className="w-full rounded-md border p-2" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>}</form.Field>
					<div><p className="font-medium">Teams</p>{teams.map((team) => <label key={team.id} className="block"><input type="checkbox" onChange={(event) => form.setFieldValue("teamIds", event.target.checked ? [...form.state.values.teamIds, team.id] : form.state.values.teamIds.filter((id) => id !== team.id))} /> {team.name}</label>)}</div>
					<div><p className="font-medium">Employees</p>{employees.map((employee) => <label key={employee.id} className="block"><input type="checkbox" onChange={(event) => form.setFieldValue("employeeIds", event.target.checked ? [...form.state.values.employeeIds, employee.id] : form.state.values.employeeIds.filter((id) => id !== employee.id))} /> {employee.name}</label>)}</div>
					<Button type="submit">{t("common.save", "Save")}</Button>
				</form>
				{initialGrants.length > 0 && <p className="text-sm text-muted-foreground">{initialGrants.length} active payroll grant(s)</p>}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 5: Implement settings page**

Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-access/page.tsx`:

```tsx
import { PayrollAccessForm } from "@/components/settings/payroll-access/payroll-access-form";
import { getPayrollAccessAdminDataAction } from "./actions";

export default async function PayrollAccessSettingsPage() {
	const result = await getPayrollAccessAdminDataAction();
	if (!result.success) {
		return <div className="p-6 text-muted-foreground">Admin access required.</div>;
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div>
				<h1 className="text-2xl font-semibold">Payroll access</h1>
				<p className="text-muted-foreground">Assign payroll-only access to selected teams and employees.</p>
			</div>
			<PayrollAccessForm employees={result.data.employees} teams={result.data.teams} initialGrants={result.data.grants} />
		</div>
	);
}
```

- [ ] **Step 6: Run form tests**

Run: `pnpm --filter @z8/webapp test src/components/settings/payroll-access/payroll-access-form.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/payroll-access' apps/webapp/src/components/settings/payroll-access
git commit -m "feat(payroll): add admin access assignment"
```

## Task 8: Navigation And App Search Visibility

**Files:**
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`
- Modify: `apps/webapp/src/lib/app-search/types.ts`
- Modify: `apps/webapp/src/lib/app-search/static-results.ts`
- Modify: `apps/webapp/src/lib/app-search/static-commands.ts`

- [ ] **Step 1: Write sidebar visibility tests**

Add to `apps/webapp/src/components/app-sidebar.test.tsx`:

```tsx
it("renders Payroll navigation when payroll access is enabled", () => {
	render(<AppSidebar employeeRole="employee" showPayrollNav />);
	expect(screen.getByText("Payroll")).toBeTruthy();
});

it("hides Payroll navigation by default", () => {
	render(<AppSidebar employeeRole="employee" />);
	expect(screen.queryByText("Payroll")).toBeNull();
});
```

- [ ] **Step 2: Run sidebar tests to verify failure**

Run: `pnpm --filter @z8/webapp test src/components/app-sidebar.test.tsx`

Expected: FAIL because `showPayrollNav` is not a prop and nav item is missing.

- [ ] **Step 3: Add sidebar prop and nav item**

Modify `apps/webapp/src/components/app-sidebar.tsx`:

```ts
import { IconCash } from "@tabler/icons-react";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	showPayrollNav?: boolean;
}
```

Include `showPayrollNav = false` in props, add it to `staticSearchInput`, and add this item to `navPersonal` after Reports:

```tsx
...(showPayrollNav
	? [
			{
				title: t("nav.payroll", "Payroll"),
				url: "/payroll",
				icon: IconCash,
			},
		]
	: []),
```

- [ ] **Step 4: Compute server sidebar visibility**

Modify `apps/webapp/src/components/server-app-sidebar.tsx`:

```ts
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
```

Before returning `<AppSidebar />`:

```ts
const showPayrollNav = Boolean(
	authContext?.employee?.role === "admin" ||
		(authContext?.employee &&
			activeOrganizationId &&
			(await hasActivePayrollAccessGrant({
				organizationId: activeOrganizationId,
				payrollEmployeeId: authContext.employee.id,
			}))),
);
```

Pass `showPayrollNav={showPayrollNav}` to `AppSidebar`.

- [ ] **Step 5: Update app search types/results**

Modify `apps/webapp/src/lib/app-search/types.ts` to add `showPayrollNav?: boolean` to `StaticAppSearchInput`.

Modify `apps/webapp/src/lib/app-search/static-results.ts` to add a Payroll result only when `input.showPayrollNav` is true:

```ts
if (input.showPayrollNav) {
	results.push({ title: input.t("nav.payroll", "Payroll"), href: "/payroll", icon: IconCash });
}
```

Modify `apps/webapp/src/lib/app-search/static-commands.ts` similarly if command actions include route navigation commands.

- [ ] **Step 6: Run sidebar tests**

Run: `pnpm --filter @z8/webapp test src/components/app-sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx apps/webapp/src/lib/app-search/types.ts apps/webapp/src/lib/app-search/static-results.ts apps/webapp/src/lib/app-search/static-commands.ts
git commit -m "feat(payroll): show scoped payroll navigation"
```

## Task 9: Final Verification And Polish

**Files:**
- Modify any files from prior tasks only to fix verified issues.

- [ ] **Step 1: Run payroll-focused tests**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/payroll-access/permissions.test.ts src/lib/payroll-workspace/summary.test.ts src/lib/payroll-workspace/pdf-exporter.test.tsx src/components/payroll/payroll-workspace.test.tsx src/components/settings/payroll-access/payroll-access-form.test.tsx src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader test suite**

Run: `pnpm test`

Expected: PASS. If unrelated pre-existing failures appear, document them with exact failing test names and confirm payroll-focused tests still pass.

- [ ] **Step 3: Run production build**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 4: Inspect git status and diff**

Run: `git status --short`

Expected: only intended files are modified or untracked.

Run: `git diff --stat HEAD`

Expected: changes are limited to scoped payroll access implementation files.

- [ ] **Step 5: Commit final fixes if any**

If Step 1-4 required fixes, run:

```bash
git add <fixed-files>
git commit -m "fix(payroll): polish scoped payroll access"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

Spec coverage:

- Dedicated access model: Task 1 and Task 2.
- Org-admin-only assignment: Task 7.
- Dynamic team membership and direct employee access: Task 2.
- No implicit self-access: Task 2 tests.
- `/payroll` workspace: Task 6.
- Month/week/custom selector: Task 6 includes explicit month/week/custom state, controls, and summary refresh behavior.
- Total worked hours and absence days by category: Task 3 and Task 6.
- Blockers that do not prevent exports: Task 3, Task 4, Task 5, Task 6.
- Combined PDF: Task 4 and Task 5.
- Existing payroll system exports: Task 5.
- Navigation visibility: Task 8.
- Final verification: Task 9.

Placeholder scan: no `TBD`, `TODO`, deferred work, or undefined future work remains. Conditional notes name exact adaptation points for current project API signatures.

Type consistency: shared payroll workspace types are defined before summary, PDF, actions, and UI tasks use them. Permission helper function names are consistent across tasks.
