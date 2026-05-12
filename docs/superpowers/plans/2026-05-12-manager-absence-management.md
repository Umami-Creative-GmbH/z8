# Manager Absence Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/team/absences`, a manager/admin page for searchable employee absence metrics and approved absence entry on behalf of employees.

**Architecture:** Add focused manager-absence server helpers beside the existing `/team` route and keep the personal `/absences` page unchanged. Server-side code owns role checks, organization scoping, employee access, metrics, and approved absence persistence; client components only render returned data and submit selected row actions.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, Effect server-action result helpers, Luxon date formatting, TanStack Form, existing shadcn-style UI components, Vitest/Testing Library.

---

## File Structure

- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts`
  - Shared request/result types for the manager absence route.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-permissions.ts`
  - Pure permission helpers and actor/target access checks.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-metrics.ts`
  - Per-employee selected-year metric calculation for a visible page of employees.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts`
  - Server actions for paginated list loading and manager/admin absence creation.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`
  - Server page that reads search params, enforces access, and passes data to the client table.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx`
  - Client table with search, year switcher, pagination links, metrics, and row action.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`
  - Client form for recording an approved absence on behalf of the selected employee.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`
  - Server tests for role scoping, pagination/search, metrics, and mutation behavior.
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`
  - UI test for metrics rendering and opening the record flow.
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
  - Add `Team Absences` to the manager/admin nav section.
- Modify: `apps/webapp/src/lib/email/render.ts`
  - Export a renderer for the employee notification email.
- Create: `apps/webapp/src/lib/email/templates/absence-recorded-by-manager.tsx`
  - Email template telling an employee an absence was recorded on their behalf.
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
  - Add in-app notification trigger for manager-recorded absences.

---

### Task 1: Define Manager Absence Types And Permission Helpers

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-permissions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`

- [ ] **Step 1: Write failing permission tests**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts` with these pure-helper tests first:

```ts
import { describe, expect, it } from "vitest";
import {
	canActorManageTarget,
	canUseManagerAbsencePage,
} from "./manager-absence-permissions";

describe("manager absence permissions", () => {
	it("allows managers to manage assigned employees", () => {
		expect(
			canActorManageTarget({
				actor: { id: "manager-1", role: "manager", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: ["manager-1"],
			}),
		).toBe(true);
	});

	it("blocks managers from unmanaged employees", () => {
		expect(
			canActorManageTarget({
				actor: { id: "manager-1", role: "manager", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: ["manager-2"],
			}),
		).toBe(false);
	});

	it("allows admins to manage active employees in the same organization", () => {
		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(true);
	});

	it("blocks cross-organization and inactive targets", () => {
		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-2", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(false);

		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: false },
				managerIdsForTarget: [],
			}),
		).toBe(false);
	});

	it("allows only managers and admins to open the page", () => {
		expect(canUseManagerAbsencePage("admin")).toBe(true);
		expect(canUseManagerAbsencePage("manager")).toBe(true);
		expect(canUseManagerAbsencePage("employee")).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: FAIL because `manager-absence-permissions.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts`:

```ts
import type { DayPeriod } from "@/lib/absences/types";

export type ManagerAbsenceRole = "admin" | "manager" | "employee";

export interface ManagerAbsenceActor {
	id: string;
	userId: string;
	organizationId: string;
	role: ManagerAbsenceRole;
	name: string;
}

export interface ManagerAbsenceEmployeeTarget {
	id: string;
	organizationId: string;
	isActive: boolean;
}

export interface ManagerAbsenceEmployeeRow {
	id: string;
	userId: string;
	name: string;
	email: string;
	employeeNumber: string | null;
	position: string | null;
	role: ManagerAbsenceRole;
	teamName: string | null;
	vacationAllowance: number;
	usedVacationDays: number;
	pendingVacationDays: number;
	remainingVacationDays: number;
	sickDays: number;
}

export interface ManagerAbsenceListParams {
	search: string;
	page: number;
	pageSize: number;
	year: number;
}

export interface ManagerAbsenceListResult {
	rows: ManagerAbsenceEmployeeRow[];
	total: number;
	page: number;
	pageSize: number;
	year: number;
	pageCount: number;
}

export interface RecordAbsenceForEmployeeInput {
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	notes?: string;
}
```

- [ ] **Step 4: Add permission helpers**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-permissions.ts`:

```ts
import type {
	ManagerAbsenceActor,
	ManagerAbsenceEmployeeTarget,
	ManagerAbsenceRole,
} from "./manager-absence-types";

export function canUseManagerAbsencePage(role: ManagerAbsenceRole): boolean {
	return role === "admin" || role === "manager";
}

export function canActorManageTarget(input: {
	actor: Pick<ManagerAbsenceActor, "id" | "organizationId" | "role">;
	target: ManagerAbsenceEmployeeTarget;
	managerIdsForTarget: string[];
}): boolean {
	const { actor, target, managerIdsForTarget } = input;

	if (!target.isActive || actor.organizationId !== target.organizationId) {
		return false;
	}

	if (actor.role === "admin") {
		return true;
	}

	if (actor.role === "manager") {
		return managerIdsForTarget.includes(actor.id);
	}

	return false;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: PASS for the permission helper tests.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts" "apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts" "apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-permissions.ts"
git commit -m "feat: add manager absence permission helpers"
```

---

### Task 2: Add Selected-Year Metrics Calculation

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-metrics.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`

- [ ] **Step 1: Add failing metrics tests**

Append this test block to `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`:

```ts
import { calculateManagerAbsenceMetrics } from "./manager-absence-metrics";

describe("manager absence metrics", () => {
	it("calculates vacation and sick metrics for the selected year", () => {
		const metrics = calculateManagerAbsenceMetrics({
			year: 2026,
			allowance: {
				defaultAnnualDays: "30",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [
				{
					id: "vacation-approved",
					employeeId: "employee-1",
					startDate: "2026-02-02",
					startPeriod: "full_day",
					endDate: "2026-02-03",
					endPeriod: "full_day",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2026-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						countsAgainstVacation: true,
					},
				},
				{
					id: "vacation-pending",
					employeeId: "employee-1",
					startDate: "2026-03-02",
					startPeriod: "full_day",
					endDate: "2026-03-02",
					endPeriod: "full_day",
					status: "pending",
					notes: null,
					approvedBy: null,
					approvedAt: null,
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						countsAgainstVacation: true,
					},
				},
				{
					id: "sick-approved",
					employeeId: "employee-1",
					startDate: "2026-04-06",
					startPeriod: "full_day",
					endDate: "2026-04-06",
					endPeriod: "full_day",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2026-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-sick",
						name: "Sick Leave",
						type: "sick",
						color: null,
						countsAgainstVacation: false,
					},
				},
			],
		});

		expect(metrics).toEqual({
			vacationAllowance: 30,
			usedVacationDays: 2,
			pendingVacationDays: 1,
			remainingVacationDays: 27,
			sickDays: 1,
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: FAIL because `manager-absence-metrics.ts` does not exist.

- [ ] **Step 3: Add metrics helper**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-metrics.ts`:

```ts
import { calculateBusinessDaysWithHalfDays } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

interface VacationAllowanceData {
	defaultAnnualDays: string;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
	carryoverExpiryMonths: number | null;
}

interface EmployeeAllowanceData {
	customAnnualDays: string | null;
	customCarryoverDays: string | null;
}

export interface ManagerAbsenceMetrics {
	vacationAllowance: number;
	usedVacationDays: number;
	pendingVacationDays: number;
	remainingVacationDays: number;
	sickDays: number;
}

export function calculateManagerAbsenceMetrics(input: {
	year: number;
	allowance: VacationAllowanceData | null;
	employeeAllowance: EmployeeAllowanceData | null;
	absences: AbsenceWithCategory[];
}): ManagerAbsenceMetrics {
	const sickDays = input.absences
		.filter((absence) => absence.status === "approved" && absence.category.type === "sick")
		.reduce(
			(total, absence) =>
				total +
				calculateBusinessDaysWithHalfDays(
					absence.startDate,
					absence.startPeriod,
					absence.endDate,
					absence.endPeriod,
					[],
				),
			0,
		);

	if (!input.allowance) {
		return {
			vacationAllowance: 0,
			usedVacationDays: 0,
			pendingVacationDays: 0,
			remainingVacationDays: 0,
			sickDays,
		};
	}

	const balance = calculateVacationBalance({
		organizationAllowance: input.allowance,
		employeeAllowance: input.employeeAllowance,
		absences: input.absences,
		currentDate: currentTimestamp(),
		year: input.year,
	});

	return {
		vacationAllowance: balance.totalDays,
		usedVacationDays: balance.usedDays,
		pendingVacationDays: balance.pendingDays,
		remainingVacationDays: balance.remainingDays,
		sickDays,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: PASS for permission and metrics tests.

- [ ] **Step 5: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts" "apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-metrics.ts"
git commit -m "feat: calculate manager absence metrics"
```

---

### Task 3: Add Server Actions For Listing And Recording Absences

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`

- [ ] **Step 1: Add server-action contract tests**

Append this lightweight contract test block to `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`:

```ts
import {
	getManagerAbsenceEmployees,
	recordAbsenceForEmployee,
} from "./actions";

describe("manager absence server action contracts", () => {
	it("exports the list and record actions", () => {
		expect(typeof getManagerAbsenceEmployees).toBe("function");
		expect(typeof recordAbsenceForEmployee).toBe("function");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: FAIL because `actions.ts` does not exist.

- [ ] **Step 3: Add server actions**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts`:

```ts
"use server";

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	vacationAllowance,
} from "@/db/schema";
import { calculateBusinessDaysWithHalfDays, dateRangesOverlap } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { auth } from "@/lib/auth";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import type { ServerActionResult } from "@/lib/effect/result";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { renderAbsenceRecordedByManager } from "@/lib/email/render";
import { EmailService } from "@/lib/effect/services/email.service";
import { AppLayer } from "@/lib/effect/runtime";
import { Effect } from "effect";
import { addCalendarSyncJob } from "@/lib/queue";
import { onAbsenceRecordedByManager } from "@/lib/notifications/triggers";
import {
	syncAbsenceRequestToCanonicalRecord,
	syncCanonicalAbsenceApprovalState,
} from "@/app/[locale]/(app)/absences/actions.canonical";
import { calculateManagerAbsenceMetrics } from "./manager-absence-metrics";
import { canActorManageTarget, canUseManagerAbsencePage } from "./manager-absence-permissions";
import type {
	ManagerAbsenceActor,
	ManagerAbsenceListParams,
	ManagerAbsenceListResult,
	RecordAbsenceForEmployeeInput,
} from "./manager-absence-types";

const ACCESSIBLE_EMPLOYEE_ERROR = "Employee not found or not accessible";

function normalizeListParams(params: Partial<ManagerAbsenceListParams>): ManagerAbsenceListParams {
	const now = DateTime.now();
	const page = Number.isFinite(params.page) && Number(params.page) > 0 ? Number(params.page) : 1;
	const pageSize = [10, 25, 50].includes(Number(params.pageSize)) ? Number(params.pageSize) : 10;
	const year = Number.isFinite(params.year) ? Number(params.year) : now.year;

	return {
		search: params.search?.trim() ?? "",
		page,
		pageSize,
		year,
	};
}

async function getActor(): Promise<ManagerAbsenceActor | null> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user || !session.session.activeOrganizationId) {
		return null;
	}

	const actor = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, session.user.id),
			eq(employee.organizationId, session.session.activeOrganizationId),
			eq(employee.isActive, true),
		),
		with: { user: true },
	});

	if (!actor) {
		return null;
	}

	return {
		id: actor.id,
		userId: actor.userId,
		organizationId: actor.organizationId,
		role: actor.role,
		name: actor.user.name,
	};
}

function toAbsenceWithCategory(absence: typeof absenceEntry.$inferSelect & { category: typeof absenceCategory.$inferSelect }): AbsenceWithCategory {
	return {
		id: absence.id,
		employeeId: absence.employeeId,
		startDate: absence.startDate,
		startPeriod: absence.startPeriod,
		endDate: absence.endDate,
		endPeriod: absence.endPeriod,
		status: absence.status,
		notes: absence.notes,
		approvedBy: absence.approvedBy,
		approvedAt: absence.approvedAt,
		rejectionReason: absence.rejectionReason,
		createdAt: absence.createdAt,
		category: {
			id: absence.category.id,
			name: absence.category.name,
			type: absence.category.type,
			color: absence.category.color,
			countsAgainstVacation: absence.category.countsAgainstVacation,
		},
	};
}

export async function getManagerAbsenceEmployees(
	params: Partial<ManagerAbsenceListParams>,
): Promise<ServerActionResult<ManagerAbsenceListResult>> {
	try {
		const actor = await getActor();
		if (!actor || !canUseManagerAbsencePage(actor.role)) {
			return { success: false, error: "You do not have permission to view team absences" };
		}

		const normalized = normalizeListParams(params);
		const offset = (normalized.page - 1) * normalized.pageSize;
		const searchFilter = normalized.search
			? or(
					ilike(employee.employeeNumber, `%${normalized.search}%`),
					ilike(sql`"user"."name"`, `%${normalized.search}%`),
					ilike(sql`"user"."email"`, `%${normalized.search}%`),
				)
			: undefined;
		const managerFilter =
			actor.role === "manager"
				? sql`exists (select 1 from employee_managers em where em.employee_id = ${employee.id} and em.manager_id = ${actor.id})`
				: undefined;
		const where = and(
			eq(employee.organizationId, actor.organizationId),
			eq(employee.isActive, true),
			managerFilter,
			searchFilter,
		);

		const [totalRow] = await db.select({ value: count() }).from(employee).where(where);
		const employees = await db.query.employee.findMany({
			where,
			with: { user: true, team: true },
			orderBy: [asc(employee.lastName), asc(employee.firstName), asc(employee.id)],
			limit: normalized.pageSize,
			offset,
		});

		const employeeIds = employees.map((row) => row.id);
		const startOfYear = `${normalized.year}-01-01`;
		const endOfYear = `${normalized.year}-12-31`;
		const [orgAllowance, employeeAllowances, absences] = await Promise.all([
			db.query.vacationAllowance.findFirst({
				where: and(
					eq(vacationAllowance.organizationId, actor.organizationId),
					eq(vacationAllowance.isCompanyDefault, true),
					eq(vacationAllowance.isActive, true),
					lte(vacationAllowance.startDate, endOfYear),
				),
				orderBy: desc(vacationAllowance.startDate),
			}),
			employeeIds.length
				? db.query.employeeVacationAllowance.findMany({
						where: and(
							inArray(employeeVacationAllowance.employeeId, employeeIds),
							eq(employeeVacationAllowance.year, normalized.year),
						),
					})
				: [],
			employeeIds.length
				? db.query.absenceEntry.findMany({
						where: and(
							inArray(absenceEntry.employeeId, employeeIds),
							gte(absenceEntry.startDate, startOfYear),
							lte(absenceEntry.endDate, endOfYear),
						),
						with: { category: true },
					})
				: [],
		]);

		const allowancesByEmployee = new Map(employeeAllowances.map((row) => [row.employeeId, row]));
		const absencesByEmployee = new Map<string, AbsenceWithCategory[]>();
		for (const absence of absences as Array<typeof absenceEntry.$inferSelect & { category: typeof absenceCategory.$inferSelect }>) {
			const mapped = toAbsenceWithCategory(absence);
			absencesByEmployee.set(mapped.employeeId, [
				...(absencesByEmployee.get(mapped.employeeId) ?? []),
				mapped,
			]);
		}

		const rows = employees.map((row) => {
			const metrics = calculateManagerAbsenceMetrics({
				year: normalized.year,
				allowance: orgAllowance ?? null,
				employeeAllowance: allowancesByEmployee.get(row.id) ?? null,
				absences: absencesByEmployee.get(row.id) ?? [],
			});

			return {
				id: row.id,
				userId: row.userId,
				name: row.user.name,
				email: row.user.email,
				employeeNumber: row.employeeNumber,
				position: row.position,
				role: row.role,
				teamName: row.team?.name ?? null,
				...metrics,
			};
		});

		return {
			success: true,
			data: {
				rows,
				total: totalRow?.value ?? 0,
				page: normalized.page,
				pageSize: normalized.pageSize,
				year: normalized.year,
				pageCount: Math.max(1, Math.ceil((totalRow?.value ?? 0) / normalized.pageSize)),
			},
		};
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Unable to load team absences" };
	}
}

export async function recordAbsenceForEmployee(
	input: RecordAbsenceForEmployeeInput,
): Promise<ServerActionResult<{ absenceId: string }>> {
	try {
		const actor = await getActor();
		if (!actor || !canUseManagerAbsencePage(actor.role)) {
			return { success: false, error: "You do not have permission to record absences" };
		}

		if (input.startDate > input.endDate) {
			return { success: false, error: "Start date must be before end date" };
		}

		if (input.startDate === input.endDate && input.startPeriod === "pm" && input.endPeriod === "am") {
			return {
				success: false,
				error: "Cannot end in the morning if starting in the afternoon on the same day",
			};
		}

		const target = await db.query.employee.findFirst({
			where: eq(employee.id, input.employeeId),
			with: { user: true },
		});
		if (!target) {
			return { success: false, error: ACCESSIBLE_EMPLOYEE_ERROR };
		}

		const managerRows = await db.query.employeeManagers.findMany({
			where: eq(employeeManagers.employeeId, target.id),
		});
		const canManage = canActorManageTarget({
			actor,
			target: {
				id: target.id,
				organizationId: target.organizationId,
				isActive: target.isActive,
			},
			managerIdsForTarget: managerRows.map((row) => row.managerId),
		});

		if (!canManage) {
			return { success: false, error: ACCESSIBLE_EMPLOYEE_ERROR };
		}

		const category = await db.query.absenceCategory.findFirst({
			where: and(
				eq(absenceCategory.id, input.categoryId),
				eq(absenceCategory.organizationId, actor.organizationId),
				eq(absenceCategory.isActive, true),
			),
		});
		if (!category) {
			return { success: false, error: "Invalid absence category" };
		}

		const overlappingAbsences = await db.query.absenceEntry.findMany({
			where: and(
				eq(absenceEntry.employeeId, target.id),
				or(eq(absenceEntry.status, "approved"), eq(absenceEntry.status, "pending")),
			),
		});
		for (const absence of overlappingAbsences) {
			if (dateRangesOverlap(input.startDate, input.endDate, absence.startDate, absence.endDate)) {
				return { success: false, error: "Absence overlaps with an existing request" };
			}
		}

		const [newAbsence] = await db
			.insert(absenceEntry)
			.values({
				employeeId: target.id,
				organizationId: actor.organizationId,
				categoryId: category.id,
				startDate: input.startDate,
				startPeriod: input.startPeriod,
				endDate: input.endDate,
				endPeriod: input.endPeriod,
				notes: input.notes,
				status: "approved",
				approvedBy: actor.id,
				approvedAt: currentTimestamp(),
			})
			.returning();

		const canonicalRecordId = await syncAbsenceRequestToCanonicalRecord({
			organizationId: actor.organizationId,
			employeeId: target.id,
			absenceCategoryId: category.id,
			startDate: input.startDate,
			startPeriod: input.startPeriod,
			endDate: input.endDate,
			endPeriod: input.endPeriod,
			countsAgainstVacation: category.countsAgainstVacation,
			requiresApproval: false,
			createdBy: actor.userId,
		});

		await db.update(absenceEntry).set({ canonicalRecordId }).where(eq(absenceEntry.id, newAbsence.id));
		await syncCanonicalAbsenceApprovalState({
			organizationId: actor.organizationId,
			canonicalRecordId,
			approvalState: "approved",
			updatedBy: actor.userId,
		});

		void addCalendarSyncJob({ absenceId: newAbsence.id, employeeId: target.id, action: "create" });

		const days = calculateBusinessDaysWithHalfDays(
			input.startDate,
			input.startPeriod,
			input.endDate,
			input.endPeriod,
			[],
		);
		const appUrl = await getOrganizationBaseUrl(actor.organizationId);
		const html = await renderAbsenceRecordedByManager({
			employeeName: target.user.name,
			managerName: actor.name,
			startDate: input.startDate,
			endDate: input.endDate,
			absenceType: category.name,
			days,
			appUrl,
		});

		void Effect.runPromise(
			Effect.gen(function* (_) {
				const emailService = yield* _(EmailService);
				yield* _(emailService.send({
					to: target.user.email,
					subject: "Absence recorded",
					html,
				}));
			}).pipe(Effect.provide(AppLayer)),
		);

		void onAbsenceRecordedByManager({
			absenceId: newAbsence.id,
			employeeUserId: target.userId,
			employeeName: target.user.name,
			organizationId: actor.organizationId,
			categoryName: category.name,
			startDate: input.startDate,
			endDate: input.endDate,
			managerName: actor.name,
		});

		return { success: true, data: { absenceId: newAbsence.id } };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Failed to record absence" };
	}
}
```

- [ ] **Step 4: Fix Drizzle query typing issues if TypeScript reports them**

If `where` rejects precomputed conditions in `findMany`, replace the `where` assignments with callback form:

```ts
where: (e, { and, eq, ilike, or, sql }) =>
	and(
		eq(e.organizationId, actor.organizationId),
		eq(e.isActive, true),
		actor.role === "manager"
			? sql`exists (select 1 from employee_managers em where em.employee_id = ${e.id} and em.manager_id = ${actor.id})`
			: undefined,
		normalized.search
			? or(
					ilike(e.employeeNumber, `%${normalized.search}%`),
					ilike(sql`"user"."name"`, `%${normalized.search}%`),
					ilike(sql`"user"."email"`, `%${normalized.search}%`),
				)
			: undefined,
	),
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: PASS for helper and export contract tests.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts" "apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts"
git commit -m "feat: add manager absence server actions"
```

---

### Task 4: Add Employee Notification Email And In-App Trigger

**Files:**
- Create: `apps/webapp/src/lib/email/templates/absence-recorded-by-manager.tsx`
- Modify: `apps/webapp/src/lib/email/render.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`

- [ ] **Step 1: Add email template**

Create `apps/webapp/src/lib/email/templates/absence-recorded-by-manager.tsx`:

```tsx
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";

interface AbsenceRecordedByManagerProps {
	employeeName: string;
	managerName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	appUrl: string;
}

export function AbsenceRecordedByManager({
	employeeName,
	managerName,
	startDate,
	endDate,
	absenceType,
	days,
	appUrl,
}: AbsenceRecordedByManagerProps) {
	return (
		<Html>
			<Head />
			<Preview>An absence was recorded for you</Preview>
			<Body style={body}>
				<Container style={container}>
					<Heading style={h1}>Absence recorded</Heading>
					<Text style={text}>Hi {employeeName},</Text>
					<Text style={text}>
						{managerName} recorded {absenceType} for {startDate} to {endDate} ({days} days) on your behalf.
					</Text>
					<Section style={buttonContainer}>
						<Button style={button} href={`${appUrl}/absences`}>
							View absences
						</Button>
					</Section>
				</Container>
			</Body>
		</Html>
	);
}

const body = { backgroundColor: "#f6f9fc", fontFamily: "Arial, sans-serif" };
const container = { backgroundColor: "#ffffff", margin: "0 auto", padding: "32px", maxWidth: "560px" };
const h1 = { color: "#111827", fontSize: "24px", fontWeight: "600", margin: "0 0 20px" };
const text = { color: "#374151", fontSize: "16px", lineHeight: "24px" };
const buttonContainer = { marginTop: "24px" };
const button = { backgroundColor: "#2563eb", borderRadius: "6px", color: "#ffffff", padding: "12px 18px", textDecoration: "none" };
```

- [ ] **Step 2: Export renderer**

Modify `apps/webapp/src/lib/email/render.ts`:

```ts
import { AbsenceRecordedByManager } from "./templates/absence-recorded-by-manager";
```

Add after the existing absence renderers:

```ts
export async function renderAbsenceRecordedByManager(props: {
	employeeName: string;
	managerName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	appUrl: string;
}) {
	return render(AbsenceRecordedByManager(props));
}
```

- [ ] **Step 3: Add in-app notification trigger**

Modify `apps/webapp/src/lib/notifications/triggers.ts` after `onAbsenceRequestApproved`:

```ts
interface AbsenceRecordedByManagerParams extends AbsenceRequestParams {
	managerName: string;
}

export async function onAbsenceRecordedByManager(
	params: AbsenceRecordedByManagerParams,
): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: "Absence recorded",
			message: `${params.managerName} recorded ${params.categoryName} for ${formatDateStr(params.startDate)} - ${formatDateStr(params.endDate)} on your behalf.`,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger manager-recorded absence notification");
	}
}
```

- [ ] **Step 4: Run type-aware tests for affected files**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/webapp/src/lib/email/templates/absence-recorded-by-manager.tsx" "apps/webapp/src/lib/email/render.ts" "apps/webapp/src/lib/notifications/triggers.ts"
git commit -m "feat: notify employees for manager-recorded absences"
```

---

### Task 5: Build Record Absence Dialog

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`

- [ ] **Step 1: Write failing UI test for dialog trigger**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamAbsencesTable } from "./team-absences-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>{children}</a>
	),
}));

describe("TeamAbsencesTable", () => {
	it("renders metrics and opens the record absence dialog", async () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [
						{
							id: "employee-1",
							userId: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							employeeNumber: "E-001",
							position: "Engineer",
							role: "employee",
							teamName: "Operations",
							vacationAllowance: 30,
							usedVacationDays: 4,
							pendingVacationDays: 2,
							remainingVacationDays: 24,
							sickDays: 1,
						},
					],
					total: 1,
					page: 1,
					pageSize: 10,
					year: 2026,
					pageCount: 1,
				}}
				categories={[{ id: "category-sick", name: "Sick Leave", type: "sick", color: null, requiresApproval: true, countsAgainstVacation: false }]}
				search=""
			/>,
		);

		expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
		expect(screen.getByText("24")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /record absence/i }));
		expect(screen.getByText("Record absence for Ada Lovelace")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/team-absences-table.test.tsx --run
```

Expected: FAIL because `team-absences-table.tsx` does not exist.

- [ ] **Step 3: Add dialog component**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`:

```tsx
"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DayPeriod } from "@/lib/absences/types";
import { useRouter } from "@/navigation";
import { recordAbsenceForEmployee } from "./actions";

interface RecordAbsenceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	employee: { id: string; name: string } | null;
	categories: Array<{ id: string; name: string; type: string; color: string | null; requiresApproval: boolean; countsAgainstVacation: boolean }>;
}

export function RecordAbsenceDialog({ open, onOpenChange, employee, categories }: RecordAbsenceDialogProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const form = useForm({
		defaultValues: {
			categoryId: "",
			startDate: "",
			startPeriod: "full_day" as DayPeriod,
			endDate: "",
			endPeriod: "full_day" as DayPeriod,
			notes: "",
		},
		onSubmit: async ({ value }) => {
			if (!employee || !value.categoryId || !value.startDate || !value.endDate) {
				toast.error(t("teamAbsences.form.errors.required", "Please fill in all required fields"));
				return;
			}

			const result = await recordAbsenceForEmployee({
				employeeId: employee.id,
				categoryId: value.categoryId,
				startDate: value.startDate,
				startPeriod: value.startPeriod,
				endDate: value.endDate,
				endPeriod: value.endPeriod,
				notes: value.notes || undefined,
			});

			if (result.success) {
				toast.success(t("teamAbsences.toast.recorded", "Absence recorded"));
				form.reset();
				onOpenChange(false);
				refresh();
				return;
			}

			toast.error(result.error || t("teamAbsences.toast.failed", "Failed to record absence"));
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<DialogHeader>
						<DialogTitle>{employee ? `Record absence for ${employee.name}` : t("teamAbsences.form.title", "Record absence")}</DialogTitle>
						<DialogDescription>{t("teamAbsences.form.description", "This creates an approved absence on behalf of the selected employee.")}</DialogDescription>
					</DialogHeader>

					<form.Field name="categoryId">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("teamAbsences.form.category", "Absence type")}</TFormLabel>
								<Select value={field.state.value} onValueChange={field.handleChange}>
									<TFormControl>
										<SelectTrigger><SelectValue placeholder={t("teamAbsences.form.selectCategory", "Select absence type")} /></SelectTrigger>
									</TFormControl>
									<SelectContent>
										{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
									</SelectContent>
								</Select>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid gap-3 sm:grid-cols-2">
						<form.Field name="startDate">
							{(field) => <TFormItem><TFormLabel>{t("teamAbsences.form.startDate", "Start date")}</TFormLabel><TFormControl><DatePicker value={field.state.value} onChange={field.handleChange} /></TFormControl><TFormMessage field={field} /></TFormItem>}
						</form.Field>
						<form.Field name="startPeriod">
							{(field) => <PeriodSelect value={field.state.value} onChange={field.handleChange} />}
						</form.Field>
						<form.Field name="endDate">
							{(field) => <TFormItem><TFormLabel>{t("teamAbsences.form.endDate", "End date")}</TFormLabel><TFormControl><DatePicker value={field.state.value} onChange={field.handleChange} /></TFormControl><TFormMessage field={field} /></TFormItem>}
						</form.Field>
						<form.Field name="endPeriod">
							{(field) => <PeriodSelect value={field.state.value} onChange={field.handleChange} />}
						</form.Field>
					</div>

					<form.Field name="notes">
						{(field) => <TFormItem><TFormLabel>{t("teamAbsences.form.notes", "Notes")}</TFormLabel><TFormControl><Textarea value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /></TFormControl><TFormMessage field={field} /></TFormItem>}
					</form.Field>

					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<DialogFooter>
								<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t("common.cancel", "Cancel")}</Button>
								<Button type="submit" disabled={isSubmitting}>{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}{t("teamAbsences.form.submit", "Record absence")}</Button>
							</DialogFooter>
						)}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function PeriodSelect({ value, onChange }: { value: DayPeriod; onChange: (value: DayPeriod) => void }) {
	return (
		<TFormItem>
			<TFormLabel>Period</TFormLabel>
			<Select value={value} onValueChange={(next) => onChange(next as DayPeriod)}>
				<SelectTrigger><SelectValue /></SelectTrigger>
				<SelectContent>
					<SelectItem value="full_day">Full day</SelectItem>
					<SelectItem value="am">Morning only</SelectItem>
					<SelectItem value="pm">Afternoon only</SelectItem>
				</SelectContent>
			</Select>
		</TFormItem>
	);
}
```

- [ ] **Step 4: Run test to confirm table is still missing**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/team-absences-table.test.tsx --run
```

Expected: FAIL because `team-absences-table.tsx` is not implemented yet.

- [ ] **Step 5: Commit dialog**

```bash
git add "apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx" "apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx"
git commit -m "feat: add record absence dialog"
```

---

### Task 6: Build Team Absences Table And Page

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`

- [ ] **Step 1: Add table component**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx`:

```tsx
"use client";

import { IconSearch } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/navigation";
import type { ManagerAbsenceEmployeeRow, ManagerAbsenceListResult } from "./manager-absence-types";
import { RecordAbsenceDialog } from "./record-absence-dialog";

interface TeamAbsencesTableProps {
	data: ManagerAbsenceListResult;
	categories: Array<{ id: string; name: string; type: string; color: string | null; requiresApproval: boolean; countsAgainstVacation: boolean }>;
	search: string;
}

export function TeamAbsencesTable({ data, categories, search }: TeamAbsencesTableProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [searchValue, setSearchValue] = useState(search);
	const [selectedEmployee, setSelectedEmployee] = useState<Pick<ManagerAbsenceEmployeeRow, "id" | "name"> | null>(null);

	const updateParams = (next: Record<string, string | number>) => {
		const params = new URLSearchParams(window.location.search);
		for (const [key, value] of Object.entries(next)) {
			params.set(key, String(value));
		}
		startTransition(() => router.push(`/team/absences?${params.toString()}`));
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<form
					className="relative w-full sm:max-w-sm"
					onSubmit={(event) => {
						event.preventDefault();
						updateParams({ search: searchValue, page: 1 });
					}}
				>
					<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder={t("teamAbsences.search", "Search employees...")} className="pl-10" />
				</form>
				<Select value={String(data.year)} onValueChange={(value) => updateParams({ year: value, page: 1 })}>
					<SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
					<SelectContent>
						{[data.year - 1, data.year, data.year + 1].map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
					</SelectContent>
				</Select>
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("teamAbsences.table.employee", "Employee")}</TableHead>
							<TableHead>{t("teamAbsences.table.team", "Team")}</TableHead>
							<TableHead className="text-right">{t("teamAbsences.table.allowance", "Allowance")}</TableHead>
							<TableHead className="text-right">{t("teamAbsences.table.used", "Used")}</TableHead>
							<TableHead className="hidden text-right md:table-cell">{t("teamAbsences.table.pending", "Pending")}</TableHead>
							<TableHead className="text-right">{t("teamAbsences.table.left", "Left")}</TableHead>
							<TableHead className="hidden text-right lg:table-cell">{t("teamAbsences.table.sick", "Sick")}</TableHead>
							<TableHead className="text-right">{t("teamAbsences.table.actions", "Actions")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.rows.map((row) => (
							<TableRow key={row.id}>
								<TableCell><div className="font-medium">{row.name}</div><div className="text-muted-foreground text-xs">{row.email}</div></TableCell>
								<TableCell>{row.teamName ? <Badge variant="secondary">{row.teamName}</Badge> : row.position || "-"}</TableCell>
								<TableCell className="text-right tabular-nums">{row.vacationAllowance}</TableCell>
								<TableCell className="text-right tabular-nums">{row.usedVacationDays}</TableCell>
								<TableCell className="hidden text-right tabular-nums md:table-cell">{row.pendingVacationDays}</TableCell>
								<TableCell className="text-right font-medium tabular-nums">{row.remainingVacationDays}</TableCell>
								<TableCell className="hidden text-right tabular-nums lg:table-cell">{row.sickDays}</TableCell>
								<TableCell className="text-right"><Button size="sm" onClick={() => setSelectedEmployee({ id: row.id, name: row.name })}>{t("teamAbsences.record", "Record absence")}</Button></TableCell>
							</TableRow>
						))}
						{data.rows.length === 0 && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{t("teamAbsences.empty", "No employees found")}</TableCell></TableRow>}
					</TableBody>
				</Table>
			</div>

			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-sm">{t("teamAbsences.pagination.summary", "Page {page} of {pageCount}", { page: data.page, pageCount: data.pageCount })}</p>
				<div className="flex gap-2">
					<Button variant="outline" size="sm" disabled={isPending || data.page <= 1} onClick={() => updateParams({ page: data.page - 1 })}>{t("teamAbsences.pagination.previous", "Previous")}</Button>
					<Button variant="outline" size="sm" disabled={isPending || data.page >= data.pageCount} onClick={() => updateParams({ page: data.page + 1 })}>{t("teamAbsences.pagination.next", "Next")}</Button>
				</div>
			</div>

			<RecordAbsenceDialog open={Boolean(selectedEmployee)} onOpenChange={(open) => !open && setSelectedEmployee(null)} employee={selectedEmployee} categories={categories} />
		</div>
	);
}
```

- [ ] **Step 2: Add server page**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getAbsenceCategories } from "@/app/[locale]/(app)/absences/actions";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee } from "../actions";
import { getManagerAbsenceEmployees } from "./actions";
import { TeamAbsencesTable } from "./team-absences-table";

interface TeamAbsencesPageProps {
	searchParams: Promise<{ search?: string; page?: string; pageSize?: string; year?: string }>;
}

export default async function TeamAbsencesPage({ searchParams }: TeamAbsencesPageProps) {
	const [t, params, currentEmployee] = await Promise.all([getTranslate(), searchParams, getCurrentEmployee()]);

	if (!currentEmployee) {
		return <div className="flex flex-1 items-center justify-center p-6"><NoEmployeeError feature={t("teamAbsences.feature", "manage team absences")} /></div>;
	}

	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		redirect("/");
	}

	const [listResult, categories] = await Promise.all([
		getManagerAbsenceEmployees({
			search: params.search ?? "",
			page: Number(params.page ?? 1),
			pageSize: Number(params.pageSize ?? 10),
			year: Number(params.year ?? new Date().getFullYear()),
		}),
		getAbsenceCategories(currentEmployee.organizationId),
	]);

	if (!listResult.success) {
		return <div className="flex flex-1 items-center justify-center p-6"><p className="text-sm text-muted-foreground">{listResult.error}</p></div>;
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-2xl font-semibold">{t("teamAbsences.title", "Team absences")}</h1>
				<p className="text-muted-foreground">{t("teamAbsences.description", "Review absence metrics and record approved absences on behalf of employees.")}</p>
			</div>
			<div className="px-4 lg:px-6">
				<TeamAbsencesTable data={listResult.data} categories={categories} search={params.search ?? ""} />
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Run UI test**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/team-absences-table.test.tsx --run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx" "apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx" "apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx"
git commit -m "feat: add team absences page"
```

---

### Task 7: Add Navigation And Search Entry

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/lib/app-search/static-results.ts`

- [ ] **Step 1: Add sidebar nav item**

Modify `apps/webapp/src/components/app-sidebar.tsx` imports:

```ts
import {
	IconBeach,
	IconCalendar,
	IconCalendarEvent,
	IconClipboardCheck,
	IconClock,
	IconDashboard,
	IconFileDescription,
	IconHelp,
	IconHierarchy,
	IconMessageCircle,
	IconReceipt,
	IconReport,
	IconSettings,
	IconShieldCheck,
	IconUsers,
} from "@tabler/icons-react";
```

Add this item to `navTeam` after the `/team` item:

```ts
{
	title: t("nav.teamAbsences", "Team Absences"),
	url: "/team/absences",
	icon: IconBeach,
},
```

- [ ] **Step 2: Add app-search static result if the file has a manager section**

Open `apps/webapp/src/lib/app-search/static-results.ts` and add this result in the manager/admin section:

```ts
{
	title: t("nav.teamAbsences", "Team Absences"),
	description: t("appSearch.teamAbsences.description", "Review employee absence metrics and record absences"),
	href: "/team/absences",
	keywords: ["team", "absence", "sick", "vacation", "manager"],
},
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts src/app/[locale]/\(app\)/team/absences/team-absences-table.test.tsx --run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/webapp/src/components/app-sidebar.tsx" "apps/webapp/src/lib/app-search/static-results.ts"
git commit -m "feat: add team absences navigation"
```

---

### Task 8: Final Verification And Cleanup

**Files:**
- Review all files touched in Tasks 1-7.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts src/app/[locale]/\(app\)/team/absences/team-absences-table.test.tsx --run
```

Expected: PASS.

- [ ] **Step 2: Run broader affected tests**

Run:

```bash
pnpm --filter webapp test src/components/absences/request-absence-dialog.test.tsx src/components/absences/absences-view-container.test.tsx --run
```

Expected: PASS.

- [ ] **Step 3: Run type/lint validation available for the package**

Run:

```bash
pnpm --filter webapp lint
```

Expected: PASS. If the project has no `lint` script, run:

```bash
pnpm --filter webapp typecheck
```

Expected: PASS if the package has a `typecheck` script.

- [ ] **Step 4: Run production build if environment does not require unavailable secrets**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. If build fails because Phase CLI or system secrets are unavailable to agents, record the skipped build and the missing variables in the final response.

- [ ] **Step 5: Inspect diff**

Run:

```bash
git diff --stat
git diff -- "apps/webapp/src/app/[locale]/(app)/team/absences" "apps/webapp/src/components/app-sidebar.tsx" "apps/webapp/src/lib/email" "apps/webapp/src/lib/notifications/triggers.ts" "apps/webapp/src/lib/app-search/static-results.ts"
```

Expected: Diff only contains manager absence management changes.

- [ ] **Step 6: Commit verification fixes if any were needed**

```bash
git add "apps/webapp/src/app/[locale]/(app)/team/absences" "apps/webapp/src/components/app-sidebar.tsx" "apps/webapp/src/lib/email" "apps/webapp/src/lib/notifications/triggers.ts" "apps/webapp/src/lib/app-search/static-results.ts"
git commit -m "fix: stabilize manager absence management"
```

Skip this commit if Step 5 shows no additional changes after the prior task commits.

---

## Self-Review Notes

- Spec coverage: The plan includes the separate `/team/absences` route, searchable paginated table, year switcher, manager/admin scoping, approved manager-created absence persistence, employee notification, and targeted tests.
- Placeholder scan: No unfinished markers, unspecified validation, or deferred implementation markers remain.
- Type consistency: Shared `ManagerAbsence*` types are defined in Task 1 and reused by server actions and UI tasks.
