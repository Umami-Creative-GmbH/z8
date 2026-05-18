# Team Yearly Time Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-scoped persisted yearly time balances to `/team`, include the current user, and render a `You` badge plus overtime/underhours indicators.

**Architecture:** Add `employee_time_balance` to the time-tracking schema, implement focused calculation/persistence helpers beside the `/team` server action, then attach balance data to the existing `ManagedEmployee` payload. Keep UI changes inside `team-members-list.tsx` and use pure helper tests for balance math and visible employee composition.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM, PostgreSQL, Effect server actions, Vitest, Testing Library, Luxon, Tolgee.

---

## File Structure

- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
  - Add the `employeeTimeBalance` table.
- Modify: `apps/webapp/src/db/schema/relations.ts`
  - Add relations from balance rows to employee and organization if relation patterns in the file require all new tables to be registered.
- Create: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts`
  - Own current-year range, formatting-independent balance math, absence adjustment math, and persistence refresh helpers.
- Create: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.test.ts`
  - Test pure balance and absence adjustment behavior.
- Modify: `apps/webapp/src/app/[locale]/(app)/team/actions.ts`
  - Include current employee, enforce org scoping, dedupe, refresh balances, and attach `timeBalance`.
- Create: `apps/webapp/src/app/[locale]/(app)/team/actions.test.ts`
  - Test exported pure helper contracts for self inclusion, dedupe, and org filtering.
- Modify: `apps/webapp/src/app/[locale]/(app)/team/page.tsx`
  - Header count automatically includes self through returned data; no separate counting logic should be introduced.
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`
  - Render `You` badge and time balance chip in cards and table.
- Create: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx`
  - Test UI rendering for `You`, positive balance, negative balance, zero balance, and table column rendering.

## Task 1: Add Persisted Time Balance Schema

**Files:**
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Test: `apps/webapp/src/db/schema/__tests__/employee-time-balance-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `apps/webapp/src/db/schema/__tests__/employee-time-balance-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { employeeTimeBalance } from "../time-tracking";

describe("employee time balance schema", () => {
	 it("defines organization-scoped yearly balance columns", () => {
		expect(employeeTimeBalance.organizationId.name).toBe("organization_id");
		expect(employeeTimeBalance.employeeId.name).toBe("employee_id");
		expect(employeeTimeBalance.year.name).toBe("year");
		expect(employeeTimeBalance.actualMinutes.name).toBe("actual_minutes");
		expect(employeeTimeBalance.expectedMinutes.name).toBe("expected_minutes");
		expect(employeeTimeBalance.absenceAdjustedMinutes.name).toBe("absence_adjusted_minutes");
		expect(employeeTimeBalance.balanceMinutes.name).toBe("balance_minutes");
		expect(employeeTimeBalance.calculatedAt.name).toBe("calculated_at");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/db/schema/__tests__/employee-time-balance-schema.test.ts
```

Expected: FAIL because `employeeTimeBalance` is not exported from `time-tracking.ts`.

- [ ] **Step 3: Add the schema table**

In `apps/webapp/src/db/schema/time-tracking.ts`, extend the pg-core import and add the table after `workPeriod`:

```ts
import {
	boolean,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
```

Add this table after the existing `workPeriod` table:

```ts
export const employeeTimeBalance = pgTable(
	"employee_time_balance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		year: integer("year").notNull(),
		actualMinutes: integer("actual_minutes").notNull(),
		expectedMinutes: integer("expected_minutes").notNull(),
		absenceAdjustedMinutes: integer("absence_adjusted_minutes").notNull(),
		balanceMinutes: integer("balance_minutes").notNull(),
		calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("employeeTimeBalance_org_employee_year_idx").on(
			table.organizationId,
			table.employeeId,
			table.year,
		),
		index("employeeTimeBalance_org_year_idx").on(table.organizationId, table.year),
		index("employeeTimeBalance_employee_org_year_idx").on(
			table.employeeId,
			table.organizationId,
			table.year,
		),
	],
);
```

- [ ] **Step 4: Add relations if required by existing relation conventions**

In `apps/webapp/src/db/schema/relations.ts`, import `employeeTimeBalance` from `./time-tracking` alongside `timeEntry` and `workPeriod`, then add:

```ts
export const employeeTimeBalanceRelations = relations(employeeTimeBalance, ({ one }) => ({
	employee: one(employee, {
		fields: [employeeTimeBalance.employeeId],
		references: [employee.id],
	}),
	organization: one(organization, {
		fields: [employeeTimeBalance.organizationId],
		references: [organization.id],
	}),
}));
```

Also add `timeBalances: many(employeeTimeBalance)` to `employeeRelations` if that relation block already groups employee-owned rows.

- [ ] **Step 5: Run the schema test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/db/schema/__tests__/employee-time-balance-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/db/schema/time-tracking.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/employee-time-balance-schema.test.ts
git commit -m "feat: add employee time balance schema"
```

## Task 2: Add Balance Math Helpers

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.test.ts`

- [ ] **Step 1: Write failing pure-helper tests**

Create `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.test.ts`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculateBalanceMinutes,
	calculateDayAbsenceAdjustmentMinutes,
	formatSignedBalance,
	getCurrentYearRange,
} from "./team-time-balance";

describe("team time balance helpers", () => {
	it("returns the current calendar year range", () => {
		const range = getCurrentYearRange(DateTime.fromISO("2026-05-18T12:00:00", { zone: "utc" }));
		expect(range.year).toBe(2026);
		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("calculates positive, negative, and zero balances", () => {
		expect(calculateBalanceMinutes({ actualMinutes: 2520, expectedMinutes: 2400, absenceAdjustedMinutes: 0 })).toBe(120);
		expect(calculateBalanceMinutes({ actualMinutes: 2100, expectedMinutes: 2400, absenceAdjustedMinutes: 0 })).toBe(-300);
		expect(calculateBalanceMinutes({ actualMinutes: 2100, expectedMinutes: 2400, absenceAdjustedMinutes: 300 })).toBe(0);
	});

	it("never lets absence adjustment make expected minutes negative", () => {
		expect(calculateBalanceMinutes({ actualMinutes: 60, expectedMinutes: 240, absenceAdjustedMinutes: 480 })).toBe(60);
	});

	it("adjusts full and half-day absences by expected day minutes", () => {
		expect(calculateDayAbsenceAdjustmentMinutes(480, "full_day")).toBe(480);
		expect(calculateDayAbsenceAdjustmentMinutes(480, "morning")).toBe(240);
		expect(calculateDayAbsenceAdjustmentMinutes(480, "afternoon")).toBe(240);
	});

	it("formats signed balances for display", () => {
		expect(formatSignedBalance(750)).toBe("+12h 30m");
		expect(formatSignedBalance(-255)).toBe("-4h 15m");
		expect(formatSignedBalance(0)).toBe("0h");
	});
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-time-balance.test.ts'
```

Expected: FAIL because `team-time-balance.ts` does not exist.

- [ ] **Step 3: Implement pure helpers**

Create `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts`:

```ts
"use server";

import { DateTime } from "luxon";
import type { absenceEntry } from "@/db/schema";

type DayPeriod = typeof absenceEntry.$inferSelect.startPeriod;

export type EmployeeTimeBalancePayload = {
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	balanceMinutes: number;
	calculatedAt: Date;
};

export function getCurrentYearRange(now: DateTime = DateTime.utc()) {
	const current = now.toUTC();
	const start = current.startOf("year");
	const end = current.endOf("year");
	return { year: current.year, start, end };
}

export function calculateBalanceMinutes(input: {
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
}) {
	const adjustedExpectedMinutes = Math.max(0, input.expectedMinutes - input.absenceAdjustedMinutes);
	return input.actualMinutes - adjustedExpectedMinutes;
}

export function calculateDayAbsenceAdjustmentMinutes(expectedDayMinutes: number, period: DayPeriod) {
	if (period === "morning" || period === "afternoon") return Math.round(expectedDayMinutes / 2);
	return expectedDayMinutes;
}

export function formatSignedBalance(balanceMinutes: number) {
	if (balanceMinutes === 0) return "0h";
	const sign = balanceMinutes > 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(balanceMinutes);
	const hours = Math.floor(absoluteMinutes / 60);
	const minutes = absoluteMinutes % 60;
	return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${minutes}m`;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-time-balance.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts' 'apps/webapp/src/app/[locale]/(app)/team/team-time-balance.test.ts'
git commit -m "feat: add team time balance helpers"
```

## Task 3: Add Balance Refresh Persistence

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.test.ts`

- [ ] **Step 1: Add focused tests for refresh input contracts**

Append to `team-time-balance.test.ts`:

```ts
import { buildEmployeeTimeBalanceValues } from "./team-time-balance";

describe("employee time balance persistence values", () => {
	it("builds persisted values from actual, expected, and absence adjustment minutes", () => {
		const calculatedAt = new Date("2026-05-18T10:00:00.000Z");
		expect(
			buildEmployeeTimeBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				year: 2026,
				actualMinutes: 2520,
				expectedMinutes: 2400,
				absenceAdjustedMinutes: 300,
				calculatedAt,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			year: 2026,
			actualMinutes: 2520,
			expectedMinutes: 2400,
			absenceAdjustedMinutes: 300,
			balanceMinutes: 420,
			calculatedAt,
		});
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-time-balance.test.ts'
```

Expected: FAIL because `buildEmployeeTimeBalanceValues` is not exported.

- [ ] **Step 3: Implement value builder and database refresh skeleton**

Extend `team-time-balance.ts` imports:

```ts
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory, absenceEntry, employeeTimeBalance, workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { calculateExpectedWorkHoursForEmployee } from "@/lib/time-tracking/calculations";
```

Add these exports below the pure helpers:

```ts
export function buildEmployeeTimeBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	calculatedAt: Date;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		year: input.year,
		actualMinutes: input.actualMinutes,
		expectedMinutes: input.expectedMinutes,
		absenceAdjustedMinutes: input.absenceAdjustedMinutes,
		balanceMinutes: calculateBalanceMinutes(input),
		calculatedAt: input.calculatedAt,
	};
}

export async function refreshEmployeeTimeBalances(input: {
	employeeIds: string[];
	organizationId: string;
	now?: DateTime;
}): Promise<Map<string, EmployeeTimeBalancePayload>> {
	const employeeIds = [...new Set(input.employeeIds)];
	const balances = new Map<string, EmployeeTimeBalancePayload>();
	if (employeeIds.length === 0) return balances;

	const range = getCurrentYearRange(input.now);
	const startDate = dateToDB(range.start)!;
	const endDate = dateToDB(range.end)!;
	const calculatedAt = new Date();

	const actualRows = await db
		.select({
			employeeId: workPeriod.employeeId,
			totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, employeeIds),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, startDate),
				lte(workPeriod.startTime, endDate),
			),
		)
		.groupBy(workPeriod.employeeId);

	const actualByEmployee = new Map(actualRows.map((row) => [row.employeeId, Number(row.totalMinutes ?? 0)]));

	for (const employeeId of employeeIds) {
		const expected = await calculateExpectedWorkHoursForEmployee(employeeId, input.organizationId, startDate, endDate);
		const absenceAdjustedMinutes = await calculateAbsenceAdjustedMinutes({
			employeeId,
			organizationId: input.organizationId,
			rangeStart: range.start,
			rangeEnd: range.end,
		});
		const values = buildEmployeeTimeBalanceValues({
			employeeId,
			organizationId: input.organizationId,
			year: range.year,
			actualMinutes: actualByEmployee.get(employeeId) ?? 0,
			expectedMinutes: expected.totalMinutes,
			absenceAdjustedMinutes,
			calculatedAt,
		});

		await db
			.insert(employeeTimeBalance)
			.values(values)
			.onConflictDoUpdate({
				target: [employeeTimeBalance.organizationId, employeeTimeBalance.employeeId, employeeTimeBalance.year],
				set: {
					actualMinutes: values.actualMinutes,
					expectedMinutes: values.expectedMinutes,
					absenceAdjustedMinutes: values.absenceAdjustedMinutes,
					balanceMinutes: values.balanceMinutes,
					calculatedAt: values.calculatedAt,
					updatedAt: values.calculatedAt,
				},
			});

		balances.set(employeeId, values);
	}

	return balances;
}
```

- [ ] **Step 4: Implement absence adjustment query**

Add this helper in `team-time-balance.ts` below `refreshEmployeeTimeBalances`:

```ts
async function calculateAbsenceAdjustedMinutes(input: {
	employeeId: string;
	organizationId: string;
	rangeStart: DateTime;
	rangeEnd: DateTime;
}) {
	const absenceRows = await db
		.select({
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.where(
			and(
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.organizationId, input.organizationId),
				eq(absenceCategory.requiresWorkTime, false),
				lte(absenceEntry.startDate, input.rangeEnd.toISODate()!),
				gte(absenceEntry.endDate, input.rangeStart.toISODate()!),
			),
		);

	let total = 0;
	for (const absence of absenceRows) {
		let current = DateTime.fromISO(absence.startDate).startOf("day");
		const last = DateTime.fromISO(absence.endDate).startOf("day");
		while (current <= last) {
			if (current >= input.rangeStart.startOf("day") && current <= input.rangeEnd.startOf("day")) {
				const expected = await calculateExpectedWorkHoursForEmployee(
					input.employeeId,
					input.organizationId,
					current.toJSDate(),
					current.toJSDate(),
				);
				let period: DayPeriod = "full_day";
				if (current.toISODate() === absence.startDate) period = absence.startPeriod;
				if (current.toISODate() === absence.endDate) period = absence.endPeriod;
				total += calculateDayAbsenceAdjustmentMinutes(expected.totalMinutes, period);
			}
			current = current.plus({ days: 1 });
		}
	}

	return total;
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-time-balance.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts' 'apps/webapp/src/app/[locale]/(app)/team/team-time-balance.test.ts'
git commit -m "feat: persist team time balances"
```

## Task 4: Include Self And Attach Balances In Team Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/team/actions.test.ts`

- [ ] **Step 1: Write failing tests for visible employee composition**

Create `apps/webapp/src/app/[locale]/(app)/team/actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildVisibleManagedEmployees } from "./actions";

const user = { id: "user-1", firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", email: "ada@example.com", image: null };

describe("team action helpers", () => {
	it("includes the current employee and marks them as current user", () => {
		const employees = buildVisibleManagedEmployees({
			currentEmployee: {
				id: "manager-1",
				userId: "user-1",
				organizationId: "org-1",
				firstName: "Ada",
				lastName: "Lovelace",
				pronouns: null,
				position: "Manager",
				role: "manager",
				isActive: true,
				team: null,
				user,
			},
			managedRecords: [],
			balances: new Map(),
		});

		expect(employees).toHaveLength(1);
		expect(employees[0]).toMatchObject({ id: "manager-1", isCurrentUser: true });
	});

	it("filters managed records to the current organization and deduplicates self", () => {
		const balances = new Map([
			["employee-1", { year: 2026, actualMinutes: 600, expectedMinutes: 480, absenceAdjustedMinutes: 0, balanceMinutes: 120, calculatedAt: new Date("2026-05-18T00:00:00.000Z") }],
		]);
		const employees = buildVisibleManagedEmployees({
			currentEmployee: {
				id: "manager-1",
				userId: "user-1",
				organizationId: "org-1",
				firstName: "Ada",
				lastName: "Lovelace",
				pronouns: null,
				position: "Manager",
				role: "manager",
				isActive: true,
				team: null,
				user,
			},
			managedRecords: [
				{ isPrimary: false, employee: { id: "manager-1", userId: "user-1", organizationId: "org-1", firstName: "Ada", lastName: "Lovelace", pronouns: null, position: "Manager", role: "manager", isActive: true, user, team: null } },
				{ isPrimary: true, employee: { id: "employee-1", userId: "user-2", organizationId: "org-1", firstName: "Grace", lastName: "Hopper", pronouns: null, position: "Engineer", role: "employee", isActive: true, user: { ...user, id: "user-2", email: "grace@example.com", name: "Grace Hopper" }, team: { id: "team-1", name: "Engineering" } } },
				{ isPrimary: true, employee: { id: "employee-2", userId: "user-3", organizationId: "org-2", firstName: "Other", lastName: "Org", pronouns: null, position: null, role: "employee", isActive: true, user: { ...user, id: "user-3", email: "other@example.com", name: "Other Org" }, team: null } },
			],
			balances,
		});

		expect(employees.map((employee) => employee.id)).toEqual(["manager-1", "employee-1"]);
		expect(employees[1]?.timeBalance?.balanceMinutes).toBe(120);
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/actions.test.ts'
```

Expected: FAIL because `buildVisibleManagedEmployees` is not exported.

- [ ] **Step 3: Extend types in `actions.ts`**

Add to `ManagedEmployee`:

```ts
isCurrentUser: boolean;
timeBalance: {
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	balanceMinutes: number;
	calculatedAt: Date;
} | null;
```

Ensure `CurrentTeamEmployee` includes `organizationId` from the employee row.

- [ ] **Step 4: Add helper and wire refresh**

In `actions.ts`, import the refresh helper:

```ts
import { refreshEmployeeTimeBalances, type EmployeeTimeBalancePayload } from "./team-time-balance";
```

Add a helper above `getManagedEmployees`:

```ts
export function buildVisibleManagedEmployees(input: {
	currentEmployee: CurrentTeamEmployee;
	managedRecords: ManagedEmployeeRecord[];
	balances: Map<string, EmployeeTimeBalancePayload>;
}): ManagedEmployee[] {
	const byId = new Map<string, ManagedEmployee>();
	const toManagedEmployee = (
		emp: ManagedEmployeeRecord["employee"] | CurrentTeamEmployee,
		isPrimaryManager: boolean,
		isCurrentUser: boolean,
	): ManagedEmployee => ({
		id: emp.id,
		userId: emp.userId,
		firstName: emp.user.firstName,
		lastName: emp.user.lastName,
		pronouns: emp.pronouns,
		position: emp.position,
		role: emp.role,
		isActive: emp.isActive,
		isPrimaryManager,
		isCurrentUser,
		timeBalance: input.balances.get(emp.id) ?? null,
		user: {
			id: emp.user.id,
			firstName: emp.user.firstName,
			lastName: emp.user.lastName,
			name: emp.user.name,
			email: emp.user.email,
			image: emp.user.image,
		},
		team: emp.team ? { id: emp.team.id, name: emp.team.name } : null,
	});

	byId.set(input.currentEmployee.id, toManagedEmployee(input.currentEmployee, false, true));
	for (const record of input.managedRecords) {
		if (record.employee.organizationId !== input.currentEmployee.organizationId) continue;
		if (record.employee.id === input.currentEmployee.id) continue;
		byId.set(record.employee.id, toManagedEmployee(record.employee, record.isPrimary, false));
	}

	return [...byId.values()];
}
```

In `getManagedEmployees`, after loading `managedEmployeeRecords`, calculate visible IDs first and refresh balances:

```ts
const typedManagedEmployeeRecords = managedEmployeeRecords as unknown as ManagedEmployeeRecord[];
const visibleEmployeeIds = [
	currentEmp.id,
	...typedManagedEmployeeRecords
		.filter((record) => record.employee.organizationId === currentEmp.organizationId)
		.map((record) => record.employee.id),
];
const balances = yield* _(
	Effect.promise(() =>
		refreshEmployeeTimeBalances({
			employeeIds: visibleEmployeeIds,
			organizationId: currentEmp.organizationId,
		}),
	),
);

return buildVisibleManagedEmployees({
	currentEmployee: currentEmp as CurrentTeamEmployee,
	managedRecords: typedManagedEmployeeRecords,
	balances,
});
```

Remove the old direct `managedEmployeeRecords.map` transformation.

- [ ] **Step 5: Run action tests**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/actions.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/team/actions.ts' 'apps/webapp/src/app/[locale]/(app)/team/actions.test.ts'
git commit -m "feat: include self in team members"
```

## Task 5: Render You Badge And Balance Indicator

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamMembersList } from "./team-members-list";
import type { ManagedEmployee } from "./actions";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/lib/query", () => ({ useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }) }));
vi.mock("@/navigation", () => ({ Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

const employee = (overrides: Partial<ManagedEmployee>): ManagedEmployee => ({
	id: "employee-1",
	userId: "user-1",
	firstName: "Ada",
	lastName: "Lovelace",
	pronouns: null,
	position: "Manager",
	role: "manager",
	isActive: true,
	isPrimaryManager: false,
	isCurrentUser: false,
	timeBalance: null,
	user: { id: "user-1", firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", email: "ada@example.com", image: null },
	team: null,
	...overrides,
});

describe("TeamMembersList", () => {
	it("renders the You badge for the current user", () => {
		render(<TeamMembersList employees={[employee({ isCurrentUser: true })]} />);
		expect(screen.getByText("You")).toBeTruthy();
	});

	it("renders signed positive, negative, and zero balances", () => {
		render(
			<TeamMembersList
				employees={[
					employee({ id: "employee-1", timeBalance: { year: 2026, actualMinutes: 600, expectedMinutes: 480, absenceAdjustedMinutes: 0, balanceMinutes: 120, calculatedAt: new Date("2026-05-18T00:00:00.000Z") } }),
					employee({ id: "employee-2", user: { id: "user-2", firstName: "Grace", lastName: "Hopper", name: "Grace Hopper", email: "grace@example.com", image: null }, timeBalance: { year: 2026, actualMinutes: 300, expectedMinutes: 480, absenceAdjustedMinutes: 0, balanceMinutes: -180, calculatedAt: new Date("2026-05-18T00:00:00.000Z") } }),
					employee({ id: "employee-3", user: { id: "user-3", firstName: "Katherine", lastName: "Johnson", name: "Katherine Johnson", email: "katherine@example.com", image: null }, timeBalance: { year: 2026, actualMinutes: 480, expectedMinutes: 480, absenceAdjustedMinutes: 0, balanceMinutes: 0, calculatedAt: new Date("2026-05-18T00:00:00.000Z") } }),
				]}
			/>,
		);

		expect(screen.getByText("+2h")).toBeTruthy();
		expect(screen.getByText("-3h")).toBeTruthy();
		expect(screen.getByText("0h")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run UI tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-members-list.test.tsx'
```

Expected: FAIL because the component does not render `You` or balance labels.

- [ ] **Step 3: Add display helpers and table column**

In `team-members-list.tsx`, import the formatter:

```ts
import { formatSignedBalance } from "./team-time-balance";
```

Add helper functions near the top of the file:

```tsx
function getBalanceVariant(balanceMinutes: number | null | undefined) {
	if (balanceMinutes == null || balanceMinutes === 0) return "outline" as const;
	return balanceMinutes > 0 ? "default" as const : "secondary" as const;
}

function TimeBalanceBadge({ employee }: { employee: ManagedEmployee }) {
	const balance = employee.timeBalance;
	if (!balance) return <Badge variant="outline">No balance</Badge>;
	return (
		<Badge variant={getBalanceVariant(balance.balanceMinutes)} className="text-xs font-normal">
			{formatSignedBalance(balance.balanceMinutes)}
		</Badge>
	);
}

function YouBadge({ show }: { show: boolean }) {
	if (!show) return null;
	return <Badge variant="outline" className="text-xs font-normal">You</Badge>;
}
```

Add a table column after the team column:

```tsx
{
	id: "timeBalance",
	header: t("team.table.timeBalance", "Year balance"),
	accessorFn: (row) => row.timeBalance?.balanceMinutes ?? 0,
	cell: ({ row }) => <TimeBalanceBadge employee={row.original} />,
},
```

- [ ] **Step 4: Render badges in name and card metadata**

In the table employee name cell, after the name and primary-manager icon, add:

```tsx
<YouBadge show={row.original.isCurrentUser} />
```

In the card title row, after the name and primary-manager icon, add:

```tsx
<YouBadge show={emp.isCurrentUser} />
```

In the card metadata badge container, add:

```tsx
<TimeBalanceBadge employee={emp} />
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-members-list.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx' 'apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx'
git commit -m "feat: show team time balances"
```

## Task 6: Verify Integration And Quality Gates

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/team/actions.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts`
- Verify: `apps/webapp/src/db/schema/time-tracking.ts`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/team-time-balance.test.ts' 'src/app/[locale]/(app)/team/actions.test.ts' 'src/app/[locale]/(app)/team/team-members-list.test.tsx' src/db/schema/__tests__/employee-time-balance-schema.test.ts
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run broader tests for touched areas**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/team/absences/actions.test.ts' 'src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx'
```

Expected: PASS. These ensure adjacent team/absence contracts still hold.

- [ ] **Step 3: Run full webapp tests when time allows**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated existing failures appear, record the failing test names and confirm focused tests pass.

- [ ] **Step 4: Run production build if environment is available**

Run:

```bash
CI=true pnpm --dir apps/webapp build
```

Expected: PASS. If build requires unavailable Phase CLI environment variables, skip and report that the build was skipped because agent access to Phase CLI secrets is unavailable.

- [ ] **Step 5: Review multi-tenancy and UI quality gates**

Check these conditions manually in the diff:

```text
All employee, work period, absence, category, and balance queries include organizationId.
No client input controls organizationId or the visible employee set.
The self employee appears once even if returned by employee_managers.
The balance indicator wraps in card view and does not create a mobile-only table dependency.
No react-hook-form changes were introduced.
Luxon is used for year-range date logic.
```

Expected: each condition is true.

- [ ] **Step 6: Commit verification fixes if any were needed**

If verification required code changes, commit them:

```bash
git add apps/webapp/src docs/superpowers/plans/2026-05-18-team-yearly-time-balance.md
git commit -m "fix: verify team time balance integration"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Notes

Spec coverage:

- Persisted org-scoped yearly field: Task 1 and Task 3.
- Current user inclusion and `You` badge: Task 4 and Task 5.
- Overtime/underhours indicator: Task 2, Task 3, and Task 5.
- Absence `requiresWorkTime` semantics: Task 3.
- Organization scoping and dedupe: Task 4 and Task 6.
- UI tests and server tests: Task 4, Task 5, and Task 6.

Completeness scan:

- Every implementation step includes concrete paths, commands, and code blocks where code changes are required.
- The only conditional instruction is relation registration in Task 1, bounded by existing project conventions and followed by a concrete code block.

Type consistency:

- `EmployeeTimeBalancePayload`, `timeBalance`, and `balanceMinutes` are used consistently across helper, action, and UI tasks.
- The table name is consistently `employeeTimeBalance` in TypeScript and `employee_time_balance` in SQL.
