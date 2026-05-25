# GFS Work Balance Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all-time employee work-balance refreshes with GFS-style monthly/yearly aggregates, a three-calendar-month hot window, and an admin-triggered employee rebuild action.

**Architecture:** Add a period aggregate table for monthly and yearly balance buckets, keep `employee_work_balance` as the fast UI read model, and move worker processing to dirty-date range recalculation. The worker recomputes raw source data only for affected closed months plus the hot window, while admin force recalculation marks one employee for a full async rebuild instead of blocking the settings page.

**Tech Stack:** Next.js 16 server actions, Drizzle ORM/Postgres, Luxon, Vitest, TanStack Query, existing shadcn/ui components, `@tabler/icons-react`.

---

## File Structure

Create:

- `apps/webapp/src/lib/work-balance/periods.ts`: Pure UTC calendar-period helpers for hot-window and month/year ranges.
- `apps/webapp/src/lib/work-balance/periods.test.ts`: Unit coverage for period boundaries.
- `apps/webapp/src/lib/work-balance/period-aggregation.ts`: Database-facing functions for monthly/yearly aggregate upsert, dirty marking, and final read-model aggregation.
- `apps/webapp/src/lib/work-balance/period-aggregation.test.ts`: Mocked Drizzle tests for aggregate orchestration.
- `apps/webapp/src/components/settings/work-balance-recalculation-card.tsx`: Admin-only employee detail card for async force recalculation.
- `apps/webapp/src/components/settings/work-balance-recalculation-card.test.tsx`: UI behavior tests for confirmation, pending state, and success/failure toasts.
- `apps/webapp/drizzle/0034_employee_work_balance_period.sql`: SQL migration for period aggregate table with `_journal.json` entry `idx: 34`, tag `0034_employee_work_balance_period`, and `when: 1779654701736` or later.

Modify:

- `apps/webapp/src/db/schema/time-tracking.ts`: Add `employeeWorkBalancePeriod` schema and supporting enum.
- `apps/webapp/src/db/schema/relations.ts`: Add relations for the period aggregate table.
- `apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts`: Assert the new schema and migration exist.
- `apps/webapp/src/lib/work-balance/service.ts`: Keep current public read helpers, add force-rebuild marking, and route computation through period aggregation.
- `apps/webapp/src/lib/work-balance/service.test.ts`: Add coverage for dirty-date use and force-rebuild marking.
- `apps/webapp/src/lib/jobs/work-balance.ts`: Process dirty ranges and full rebuild requests instead of unconditional all-time recomputation.
- `apps/webapp/src/lib/jobs/work-balance.test.ts`: Add worker orchestration tests.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`: Add org-admin-only force recalculation server action.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`: Add authorization and dirty marking tests.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`: Export the server action.
- `apps/webapp/src/lib/query/use-employee.ts`: Add TanStack mutation for force recalculation.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`: Render the recalculation card for org admins.

Do not modify `apps/webapp/src/db/auth-schema.ts`.

---

### Task 1: Add Period Aggregate Schema And Migration

**Files:**

- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts`
- Create: `apps/webapp/drizzle/0034_employee_work_balance_period.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the failing schema test**

Add this test block to `apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts` after the existing recovery migration test.

```ts
it("defines monthly and yearly employee work balance period buckets", () => {
	expect(employeeWorkBalancePeriod.id.name).toBe("id");
	expect(employeeWorkBalancePeriod.organizationId.name).toBe("organization_id");
	expect(employeeWorkBalancePeriod.employeeId.name).toBe("employee_id");
	expect(employeeWorkBalancePeriod.periodType.name).toBe("period_type");
	expect(employeeWorkBalancePeriod.periodStart.name).toBe("period_start");
	expect(employeeWorkBalancePeriod.periodEnd.name).toBe("period_end");
	expect(employeeWorkBalancePeriod.actualMinutes.name).toBe("actual_minutes");
	expect(employeeWorkBalancePeriod.requiredMinutes.name).toBe("required_minutes");
	expect(employeeWorkBalancePeriod.balanceMinutes.name).toBe("balance_minutes");
	expect(employeeWorkBalancePeriod.computedAt.name).toBe("computed_at");
	expect(employeeWorkBalancePeriod.isClosed.name).toBe("is_closed");
	expect(employeeWorkBalancePeriod.isDirty.name).toBe("is_dirty");
	expect(employeeWorkBalancePeriod.dirtyFromDate.name).toBe("dirty_from_date");
	expect(employeeWorkBalancePeriod.refreshRequestedAt.name).toBe("refresh_requested_at");
	expect(employeeWorkBalancePeriod.lastError.name).toBe("last_error");
});

it("includes a migration for employee work balance period buckets", () => {
	const migrationUrl = new URL(
		"../../../../drizzle/0034_employee_work_balance_period.sql",
		import.meta.url,
	);
	expect(existsSync(migrationUrl)).toBe(true);

	const migration = readFileSync(migrationUrl, "utf8");
	expect(migration).toContain('CREATE TYPE "employee_work_balance_period_type"');
	expect(migration).toContain('CREATE TABLE "employee_work_balance_period"');
	expect(migration).toContain('CREATE UNIQUE INDEX "employeeWorkBalancePeriod_org_employee_type_start_idx"');
	expect(migration).toContain('CREATE INDEX "employeeWorkBalancePeriod_dirty_idx"');
	expect(migration).toContain('FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade');
});
```

Also update the import at the top of that test file:

```ts
import { employeeWorkBalance, employeeWorkBalancePeriod } from "../time-tracking";
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/db/schema/__tests__/employee-work-balance-schema.test.ts
```

Expected: FAIL because `employeeWorkBalancePeriod` and its migration do not exist.

- [ ] **Step 3: Add the Drizzle schema**

Modify imports in `apps/webapp/src/db/schema/time-tracking.ts` to include `pgEnum`:

```ts
import {
	boolean,
	date,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
```

Add the enum and table after `employeeWorkBalance`:

```ts
export const employeeWorkBalancePeriodTypeEnum = pgEnum(
	"employee_work_balance_period_type",
	["month", "year"],
);

export const employeeWorkBalancePeriod = pgTable(
	"employee_work_balance_period",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		periodType: employeeWorkBalancePeriodTypeEnum("period_type").notNull(),
		periodStart: date("period_start").notNull(),
		periodEnd: date("period_end").notNull(),
		actualMinutes: integer("actual_minutes").default(0).notNull(),
		requiredMinutes: integer("required_minutes").default(0).notNull(),
		balanceMinutes: integer("balance_minutes").default(0).notNull(),
		computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
		isClosed: boolean("is_closed").default(false).notNull(),
		isDirty: boolean("is_dirty").default(false).notNull(),
		dirtyFromDate: date("dirty_from_date"),
		refreshRequestedAt: timestamp("refresh_requested_at", { withTimezone: true }),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("employeeWorkBalancePeriod_org_employee_type_start_idx").on(
			table.organizationId,
			table.employeeId,
			table.periodType,
			table.periodStart,
		),
		index("employeeWorkBalancePeriod_org_type_start_idx").on(
			table.organizationId,
			table.periodType,
			table.periodStart,
		),
		index("employeeWorkBalancePeriod_employee_org_idx").on(
			table.employeeId,
			table.organizationId,
		),
		index("employeeWorkBalancePeriod_dirty_idx").on(
			table.isDirty,
			table.refreshRequestedAt,
		),
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
```

- [ ] **Step 4: Add schema relations**

Modify `apps/webapp/src/db/schema/relations.ts` imports to include `employeeWorkBalancePeriod` from `./time-tracking`.

Add `workBalancePeriods` to the employee relations object:

```ts
workBalancePeriods: many(employeeWorkBalancePeriod),
```

Add relations near the existing `employeeWorkBalanceRelations`:

```ts
export const employeeWorkBalancePeriodRelations = relations(
	employeeWorkBalancePeriod,
	({ one }) => ({
		employee: one(employee, {
			fields: [employeeWorkBalancePeriod.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [employeeWorkBalancePeriod.organizationId],
			references: [organization.id],
		}),
	}),
);
```

- [ ] **Step 5: Add the SQL migration**

Create `apps/webapp/drizzle/0034_employee_work_balance_period.sql` with this SQL body:

```sql
CREATE TYPE "employee_work_balance_period_type" AS ENUM ('month', 'year');
--> statement-breakpoint
CREATE TABLE "employee_work_balance_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"period_type" "employee_work_balance_period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"required_minutes" integer DEFAULT 0 NOT NULL,
	"balance_minutes" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"dirty_from_date" date,
	"refresh_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_work_balance_period" ADD CONSTRAINT "employee_work_balance_period_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance_period" ADD CONSTRAINT "employee_work_balance_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance_period" ADD CONSTRAINT "employee_work_balance_period_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "employeeWorkBalancePeriod_org_employee_type_start_idx" ON "employee_work_balance_period" USING btree ("organization_id","employee_id","period_type","period_start");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalancePeriod_org_type_start_idx" ON "employee_work_balance_period" USING btree ("organization_id","period_type","period_start");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalancePeriod_employee_org_idx" ON "employee_work_balance_period" USING btree ("employee_id","organization_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalancePeriod_dirty_idx" ON "employee_work_balance_period" USING btree ("is_dirty","refresh_requested_at");
```

Add this matching entry to `apps/webapp/drizzle/meta/_journal.json` after the `0033_product_improvement_consent` entry:

```json
{
  "idx": 34,
  "version": "7",
  "when": 1779654701736,
  "tag": "0034_employee_work_balance_period",
  "breakpoints": true
}
```

- [ ] **Step 6: Run the schema test to verify it passes**

Run:

```bash
pnpm --filter webapp test src/db/schema/__tests__/employee-work-balance-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/db/schema/time-tracking.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts apps/webapp/drizzle/0034_employee_work_balance_period.sql apps/webapp/drizzle/meta/_journal.json
git commit -m "feat: add work balance period aggregates"
```

---

### Task 2: Add Calendar Period Helpers

**Files:**

- Create: `apps/webapp/src/lib/work-balance/periods.ts`
- Create: `apps/webapp/src/lib/work-balance/periods.test.ts`

- [ ] **Step 1: Write the failing period helper tests**

Create `apps/webapp/src/lib/work-balance/periods.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	getClosedMonthRange,
	getHotWindowRange,
	getMonthPeriodsBetween,
	getYearPeriodForDate,
} from "./periods";

describe("work balance period helpers", () => {
	it("uses current UTC month plus previous two months as the hot window", () => {
		expect(getHotWindowRange(new Date("2026-05-25T13:00:00.000Z"))).toEqual({
			startDate: "2026-03-01",
			endDate: "2026-05-25",
		});
	});

	it("normalizes a date to its closed month range", () => {
		expect(getClosedMonthRange("2026-02-14")).toEqual({
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
		});
	});

	it("lists month periods between two dates", () => {
		expect(getMonthPeriodsBetween("2025-12-15", "2026-02-02")).toEqual([
			{ periodStart: "2025-12-01", periodEnd: "2025-12-31" },
			{ periodStart: "2026-01-01", periodEnd: "2026-01-31" },
			{ periodStart: "2026-02-01", periodEnd: "2026-02-28" },
		]);
	});

	it("normalizes a date to its year range", () => {
		expect(getYearPeriodForDate("2026-05-25")).toEqual({
			periodStart: "2026-01-01",
			periodEnd: "2026-12-31",
		});
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm --filter webapp test src/lib/work-balance/periods.test.ts
```

Expected: FAIL because `periods.ts` does not exist.

- [ ] **Step 3: Implement the period helpers**

Create `apps/webapp/src/lib/work-balance/periods.ts`:

```ts
import { DateTime } from "luxon";

export interface DateRangeIso {
	startDate: string;
	endDate: string;
}

export interface PeriodRangeIso {
	periodStart: string;
	periodEnd: string;
}

function parseIsoDate(date: string) {
	return DateTime.fromISO(date, { zone: "utc" }).startOf("day");
}

function toIsoDate(date: DateTime) {
	return date.toISODate()!;
}

export function getHotWindowRange(now = new Date()): DateRangeIso {
	const today = DateTime.fromJSDate(now, { zone: "utc" }).startOf("day");
	return {
		startDate: toIsoDate(today.startOf("month").minus({ months: 2 })),
		endDate: toIsoDate(today),
	};
}

export function getClosedMonthRange(date: string): PeriodRangeIso {
	const cursor = parseIsoDate(date);
	return {
		periodStart: toIsoDate(cursor.startOf("month")),
		periodEnd: toIsoDate(cursor.endOf("month").startOf("day")),
	};
}

export function getYearPeriodForDate(date: string): PeriodRangeIso {
	const cursor = parseIsoDate(date);
	return {
		periodStart: toIsoDate(cursor.startOf("year")),
		periodEnd: toIsoDate(cursor.endOf("year").startOf("day")),
	};
}

export function getMonthPeriodsBetween(startDate: string, endDate: string): PeriodRangeIso[] {
	const start = parseIsoDate(startDate).startOf("month");
	const end = parseIsoDate(endDate).startOf("month");
	if (!start.isValid || !end.isValid || end < start) return [];

	const periods: PeriodRangeIso[] = [];
	for (let cursor = start; cursor <= end; cursor = cursor.plus({ months: 1 })) {
		periods.push(getClosedMonthRange(toIsoDate(cursor)));
	}
	return periods;
}

export function isBeforeHotWindow(date: string, now = new Date()): boolean {
	return date < getHotWindowRange(now).startDate;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
pnpm --filter webapp test src/lib/work-balance/periods.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/lib/work-balance/periods.ts apps/webapp/src/lib/work-balance/periods.test.ts
git commit -m "feat: add work balance period helpers"
```

---

### Task 3: Implement Period Aggregation Service

**Files:**

- Create: `apps/webapp/src/lib/work-balance/period-aggregation.ts`
- Create: `apps/webapp/src/lib/work-balance/period-aggregation.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Create `apps/webapp/src/lib/work-balance/period-aggregation.test.ts` with mocked dependencies:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	db: {
		insert: vi.fn(),
		select: vi.fn(),
		update: vi.fn(),
	},
	insertValues: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	selectFrom: vi.fn(),
	selectWhere: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	getDailyWorkRequirementsForEmployee: vi.fn(),
}));

vi.mock("@/db", () => ({ db: mockState.db }));
vi.mock("@/lib/calendar/work-policy-requirements", () => ({
	getDailyWorkRequirementsForEmployee: mockState.getDailyWorkRequirementsForEmployee,
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
	isNotNull: vi.fn((value: unknown) => ({ isNotNull: value })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: Array.from(strings), values })),
}));

import {
	buildPeriodBalanceValues,
	computeEmployeePeriodBalance,
	markEmployeeWorkBalanceFullRebuildRequested,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";

describe("work balance period aggregation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.db.insert.mockReturnValue({ values: mockState.insertValues });
		mockState.insertValues.mockReturnValue({ onConflictDoUpdate: mockState.onConflictDoUpdate });
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValue({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValue([{ totalMinutes: 480 }]);
		mockState.db.update.mockReturnValue({ set: mockState.updateSet });
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({
			"2026-02-02": { requiredMinutes: 420 },
		});
	});

	it("builds monthly period values with derived balance", () => {
		const computedAt = new Date("2026-05-25T12:00:00.000Z");
		expect(
			buildPeriodBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 480,
				requiredMinutes: 420,
				isClosed: true,
				computedAt,
			}),
		).toEqual(expect.objectContaining({ balanceMinutes: 60, isDirty: false }));
	});

	it("computes a period from raw work periods and daily requirements", async () => {
		const result = await computeEmployeePeriodBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
			isClosed: true,
			now: new Date("2026-05-25T12:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({ actualMinutes: 480, requiredMinutes: 420, balanceMinutes: 60 }),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: new Date("2026-02-01T00:00:00.000Z"),
				endDate: new Date("2026-02-28T23:59:59.999Z"),
			}),
		);
	});

	it("upserts period values by organization employee period type and start", async () => {
		await upsertEmployeeWorkBalancePeriod(
			buildPeriodBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 480,
				requiredMinutes: 420,
				isClosed: true,
				computedAt: new Date("2026-05-25T12:00:00.000Z"),
			}),
		);

		expect(mockState.onConflictDoUpdate).toHaveBeenCalledTimes(1);
	});

	it("marks full rebuild requests without recalculating synchronously", async () => {
		await markEmployeeWorkBalanceFullRebuildRequested({
			employeeId: "employee-1",
			organizationId: "org-1",
			requestedAt: new Date("2026-05-25T12:00:00.000Z"),
		});

		expect(mockState.db.update).toHaveBeenCalled();
		expect(mockState.updateWhere).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run aggregation tests to verify they fail**

Run:

```bash
pnpm --filter webapp test src/lib/work-balance/period-aggregation.test.ts
```

Expected: FAIL because `period-aggregation.ts` does not exist.

- [ ] **Step 3: Implement aggregation functions**

Create `apps/webapp/src/lib/work-balance/period-aggregation.ts`:

```ts
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { getYearPeriodForDate } from "./periods";

export type EmployeeWorkBalancePeriodType = "month" | "year";

export function buildPeriodBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	periodType: EmployeeWorkBalancePeriodType;
	periodStart: string;
	periodEnd: string;
	actualMinutes: number;
	requiredMinutes: number;
	isClosed: boolean;
	computedAt: Date;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: input.periodType,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		actualMinutes: input.actualMinutes,
		requiredMinutes: input.requiredMinutes,
		balanceMinutes: input.actualMinutes - input.requiredMinutes,
		computedAt: input.computedAt,
		isClosed: input.isClosed,
		isDirty: false,
		dirtyFromDate: null,
		refreshRequestedAt: null,
		lastError: null,
		updatedAt: input.computedAt,
	};
}

async function getActualMinutesForRange(input: {
	employeeId: string;
	organizationId: string;
	startDate: Date;
	endDate: Date;
}) {
	const [row] = await db
		.select({ totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)` })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, input.startDate),
				lte(workPeriod.startTime, input.endDate),
			),
		);

	return Number(row?.totalMinutes ?? 0);
}

export async function computeEmployeePeriodBalance(input: {
	employeeId: string;
	organizationId: string;
	periodType: EmployeeWorkBalancePeriodType;
	periodStart: string;
	periodEnd: string;
	isClosed: boolean;
	now?: Date;
}) {
	const start = DateTime.fromISO(input.periodStart, { zone: "utc" }).startOf("day");
	const end = DateTime.fromISO(input.periodEnd, { zone: "utc" }).endOf("day");
	const computedAt = input.now ?? new Date();
	const [actualMinutes, requirements] = await Promise.all([
		getActualMinutesForRange({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			startDate: start.toJSDate(),
			endDate: end.toJSDate(),
		}),
		getDailyWorkRequirementsForEmployee({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			startDate: start.toJSDate(),
			endDate: end.toJSDate(),
		}),
	]);

	const requiredMinutes = Object.values(requirements).reduce(
		(total, requirement) => total + requirement.requiredMinutes,
		0,
	);

	return buildPeriodBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: input.periodType,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		actualMinutes,
		requiredMinutes,
		isClosed: input.isClosed,
		computedAt,
	});
}

export async function upsertEmployeeWorkBalancePeriod(
	values: ReturnType<typeof buildPeriodBalanceValues>,
) {
	await db
		.insert(employeeWorkBalancePeriod)
		.values(values)
		.onConflictDoUpdate({
			target: [
				employeeWorkBalancePeriod.organizationId,
				employeeWorkBalancePeriod.employeeId,
				employeeWorkBalancePeriod.periodType,
				employeeWorkBalancePeriod.periodStart,
			],
			set: {
				periodEnd: values.periodEnd,
				actualMinutes: values.actualMinutes,
				requiredMinutes: values.requiredMinutes,
				balanceMinutes: values.balanceMinutes,
				computedAt: values.computedAt,
				isClosed: values.isClosed,
				isDirty: false,
				dirtyFromDate: null,
				refreshRequestedAt: null,
				lastError: null,
				updatedAt: values.updatedAt,
			},
		});
}

export async function rebuildEmployeeYearBalanceFromMonths(input: {
	employeeId: string;
	organizationId: string;
	dateInYear: string;
	now?: Date;
}) {
	const year = getYearPeriodForDate(input.dateInYear);
	const [row] = await db
		.select({
			actualMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.actualMinutes}), 0)`,
			requiredMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.requiredMinutes}), 0)`,
		})
		.from(employeeWorkBalancePeriod)
		.where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
				eq(employeeWorkBalancePeriod.periodType, "month"),
				eq(employeeWorkBalancePeriod.isClosed, true),
				gte(employeeWorkBalancePeriod.periodStart, year.periodStart),
				lte(employeeWorkBalancePeriod.periodEnd, year.periodEnd),
			),
		);

	await upsertEmployeeWorkBalancePeriod(
		buildPeriodBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			periodType: "year",
			periodStart: year.periodStart,
			periodEnd: year.periodEnd,
			actualMinutes: Number(row?.actualMinutes ?? 0),
			requiredMinutes: Number(row?.requiredMinutes ?? 0),
			isClosed: true,
			computedAt: input.now ?? new Date(),
		}),
	);
}

export async function markEmployeeWorkBalanceFullRebuildRequested(input: {
	employeeId: string;
	organizationId: string;
	requestedAt?: Date;
}) {
	const requestedAt = input.requestedAt ?? new Date();
	await db
		.update(employeeWorkBalancePeriod)
		.set({
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		})
		.where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
			),
		);

	await db
		.update(employeeWorkBalance)
		.set({
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		})
		.where(
			and(
				eq(employeeWorkBalance.employeeId, input.employeeId),
				eq(employeeWorkBalance.organizationId, input.organizationId),
			),
		);
}
```

- [ ] **Step 4: Export force-rebuild marking from `service.ts`**

Add this import to `apps/webapp/src/lib/work-balance/service.ts`:

```ts
import { markEmployeeWorkBalanceFullRebuildRequested } from "./period-aggregation";
```

Add this export near other dirty-marking functions:

```ts
export async function requestEmployeeWorkBalanceFullRebuild(input: {
	employeeId: string;
	organizationId: string;
}) {
	await markEmployeeWorkBalanceFullRebuildRequested(input);
}
```

- [ ] **Step 5: Run aggregation and service tests**

Run:

```bash
pnpm --filter webapp test src/lib/work-balance/period-aggregation.test.ts src/lib/work-balance/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/lib/work-balance/period-aggregation.ts apps/webapp/src/lib/work-balance/period-aggregation.test.ts apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts
git commit -m "feat: add work balance period aggregation"
```

---

### Task 4: Update Worker To Process Dirty Period Ranges

**Files:**

- Modify: `apps/webapp/src/lib/jobs/work-balance.ts`
- Create: `apps/webapp/src/lib/jobs/work-balance.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.test.ts`

- [ ] **Step 1: Write failing worker orchestration tests**

Create `apps/webapp/src/lib/jobs/work-balance.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listEmployeesForWorkBalanceBatch: vi.fn(),
	refreshEmployeeWorkBalanceFromPeriods: vi.fn(),
	markEmployeeWorkBalanceFailed: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@/lib/work-balance/service", () => ({
	listEmployeesForWorkBalanceBatch: mocks.listEmployeesForWorkBalanceBatch,
	refreshEmployeeWorkBalanceFromPeriods: mocks.refreshEmployeeWorkBalanceFromPeriods,
	markEmployeeWorkBalanceFailed: mocks.markEmployeeWorkBalanceFailed,
}));

import { runWorkBalanceRefresh } from "./work-balance";

describe("work balance refresh job", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.markEmployeeWorkBalanceFailed.mockResolvedValue(undefined);
	});

	it("refreshes selected employees through the period-based service", async () => {
		mocks.listEmployeesForWorkBalanceBatch.mockResolvedValue([
			{ id: "employee-1", organizationId: "org-1", dirtyFromDate: "2026-02-10" },
		]);
		mocks.refreshEmployeeWorkBalanceFromPeriods.mockResolvedValue({ updated: true });

		const result = await runWorkBalanceRefresh();

		expect(result.employeesProcessed).toBe(1);
		expect(result.balancesUpdated).toBe(1);
		expect(mocks.refreshEmployeeWorkBalanceFromPeriods).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: "2026-02-10",
			}),
		);
	});

	it("continues after one employee refresh fails", async () => {
		mocks.listEmployeesForWorkBalanceBatch.mockResolvedValue([
			{ id: "employee-1", organizationId: "org-1", dirtyFromDate: null },
			{ id: "employee-2", organizationId: "org-1", dirtyFromDate: null },
		]);
		mocks.refreshEmployeeWorkBalanceFromPeriods
			.mockRejectedValueOnce(new Error("period refresh failed"))
			.mockResolvedValueOnce({ updated: true });

		const result = await runWorkBalanceRefresh();

		expect(result.success).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.balancesUpdated).toBe(1);
		expect(mocks.markEmployeeWorkBalanceFailed).toHaveBeenCalledWith(
			expect.objectContaining({ employeeId: "employee-1", error: "period refresh failed" }),
		);
	});
});
```

- [ ] **Step 2: Run worker test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/lib/jobs/work-balance.test.ts
```

Expected: FAIL because `refreshEmployeeWorkBalanceFromPeriods` is not implemented or not used.

- [ ] **Step 3: Add period-based refresh service skeleton**

Add these imports to `apps/webapp/src/lib/work-balance/service.ts`:

```ts
import {
	computeEmployeePeriodBalance,
	rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";
import { getHotWindowRange, getMonthPeriodsBetween } from "./periods";
```

Add this exported function near `computeEmployeeWorkBalance`:

```ts
async function getClosedMonthlyPeriodTotals(input: {
	employeeId: string;
	organizationId: string;
	beforeDate: string;
}) {
	const [row] = await db
		.select({
			actualMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.actualMinutes}), 0)`,
			requiredMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.requiredMinutes}), 0)`,
		})
		.from(employeeWorkBalancePeriod)
		.where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
				eq(employeeWorkBalancePeriod.periodType, "month"),
				eq(employeeWorkBalancePeriod.isClosed, true),
				lt(employeeWorkBalancePeriod.periodStart, input.beforeDate),
			),
		);

	return {
		actualMinutes: Number(row?.actualMinutes ?? 0),
		requiredMinutes: Number(row?.requiredMinutes ?? 0),
	};
}

export async function refreshEmployeeWorkBalanceFromPeriods(input: {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string | null;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const hotWindow = getHotWindowRange(now);
	const affectedStartDate = input.dirtyFromDate ?? hotWindow.startDate;
	const closedMonthEnd = DateTime.fromISO(hotWindow.startDate, { zone: "utc" })
		.minus({ days: 1 })
		.toISODate()!;

	if (affectedStartDate < hotWindow.startDate) {
		const touchedYears = new Set<string>();
		for (const period of getMonthPeriodsBetween(affectedStartDate, closedMonthEnd)) {
			const values = await computeEmployeePeriodBalance({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				periodType: "month",
				periodStart: period.periodStart,
				periodEnd: period.periodEnd,
				isClosed: true,
				now,
			});
			await upsertEmployeeWorkBalancePeriod(values);
			touchedYears.add(period.periodStart.slice(0, 4));
		}

		for (const year of touchedYears) {
			await rebuildEmployeeYearBalanceFromMonths({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				dateInYear: `${year}-01-01`,
				now,
			});
		}
	}

	const hotValues = await computeEmployeePeriodBalance({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: "month",
		periodStart: hotWindow.startDate,
		periodEnd: hotWindow.endDate,
		isClosed: false,
		now,
	});
	const closedTotals = await getClosedMonthlyPeriodTotals({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		beforeDate: hotWindow.startDate,
	});

	await upsertEmployeeWorkBalance(
		buildWorkBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: closedTotals.actualMinutes + hotValues.actualMinutes,
			requiredMinutes: closedTotals.requiredMinutes + hotValues.requiredMinutes,
			computedFromDate: hotWindow.startDate,
			computedThroughDate: hotWindow.endDate,
			computedAt: now,
		}),
		{ refreshStartedAt: now },
	);

	return { updated: true };
}
```

Also update the `service.ts` imports to include `employeeWorkBalancePeriod` from `@/db/schema`. The read-model aggregate now stores closed monthly history plus the hot-window totals, so the UI does not lose older history.

- [ ] **Step 4: Update employee batch selection to return dirty metadata**

Change the select in `listEmployeesForWorkBalanceBatch` in `apps/webapp/src/lib/work-balance/service.ts`:

```ts
.select({
	id: employee.id,
	organizationId: employee.organizationId,
	dirtyFromDate: employeeWorkBalance.dirtyFromDate,
	refreshRequestedAt: employeeWorkBalance.refreshRequestedAt,
})
```

- [ ] **Step 5: Update the worker to call the period refresh**

Modify imports in `apps/webapp/src/lib/jobs/work-balance.ts` to remove `buildEmptyWorkBalanceValues`, `computeEmployeeWorkBalance`, and `upsertEmployeeWorkBalance`, then import `refreshEmployeeWorkBalanceFromPeriods`.

Replace the inner try block in `runWorkBalanceRefresh` with:

```ts
const refreshStartedAt = new Date();
const refreshResult = await refreshEmployeeWorkBalanceFromPeriods({
	employeeId: employee.id,
	organizationId: employee.organizationId,
	dirtyFromDate: employee.dirtyFromDate,
	now: refreshStartedAt,
});

if (refreshResult.updated) {
	result.balancesUpdated += 1;
} else {
	result.skipped += 1;
}
```

- [ ] **Step 6: Run worker and service tests**

Run:

```bash
pnpm --filter webapp test src/lib/jobs/work-balance.test.ts src/lib/work-balance/service.test.ts src/lib/work-balance/period-aggregation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/lib/jobs/work-balance.ts apps/webapp/src/lib/jobs/work-balance.test.ts apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts
git commit -m "feat: refresh work balances by dirty period"
```

---

### Task 5: Add Admin Force Recalculation Server Action

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.ts`

- [ ] **Step 1: Write failing server action tests**

Add `requestEmployeeWorkBalanceFullRebuild` to the hoisted mocks in `employee-mutations.actions.test.ts`:

```ts
requestEmployeeWorkBalanceFullRebuild: vi.fn(),
```

Update the `@/lib/work-balance/service` mock:

```ts
vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mocks.markEmployeeWorkBalanceDirty,
	requestEmployeeWorkBalanceFullRebuild: mocks.requestEmployeeWorkBalanceFullRebuild,
}));
```

Import the action:

```ts
import {
	assignManagersAction,
	createEmployeeAction,
	requestEmployeeWorkBalanceRecalculationAction,
	updateEmployeeAction,
} from "./employee-mutations.actions";
```

Add this test block near the other mutation action tests:

```ts
describe("requestEmployeeWorkBalanceRecalculationAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.runTracedEmployeeAction.mockImplementation(({ execute }) =>
			Effect.runPromise(execute({ setAttribute: vi.fn() })),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
		mocks.requestEmployeeWorkBalanceFullRebuild.mockResolvedValue(undefined);
	});

	it("requires org admin access and marks the target employee for full rebuild", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				session: { user: { id: "user-admin-1" } },
				organizationId: "org-1",
				accessTier: "orgAdmin",
				currentEmployee: { id: "employee-admin-1", role: "admin", organizationId: "org-1" },
				dbService: {},
			}),
		);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({ id: "employee-1", organizationId: "org-1", role: "employee" }),
		);

		const result = await requestEmployeeWorkBalanceRecalculationAction("employee-1");

		expect(result.success).toBe(true);
		expect(mocks.requireOrgAdminEmployeeSettingsAccess).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
			expect.objectContaining({ action: "recalculate_work_balance" }),
		);
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
		});
	});
});
```

- [ ] **Step 2: Run action tests to verify they fail**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'
```

Expected: FAIL because `requestEmployeeWorkBalanceRecalculationAction` is not exported.

- [ ] **Step 3: Implement the server action**

Add `requestEmployeeWorkBalanceFullRebuild` to imports from `@/lib/work-balance/service` in `employee-mutations.actions.ts`:

```ts
import {
	markEmployeeWorkBalanceDirty,
	requestEmployeeWorkBalanceFullRebuild,
} from "@/lib/work-balance/service";
```

Add this action near the other exported mutation actions:

```ts
export async function requestEmployeeWorkBalanceRecalculationAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "requestEmployeeWorkBalanceRecalculation",
		attributes: { "employee.id": employeeId },
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to request employee work balance recalculation");
		},
		execute: (span) =>
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can recalculate employee work balances",
						resource: "employee_work_balance",
						action: "recalculate_work_balance",
					}),
				);

				const targetEmployee = yield* _(getTargetEmployee(employeeId));
				if (targetEmployee.organizationId !== actor.organizationId) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Employee does not belong to the active organization",
								field: "employeeId",
								value: employeeId,
							}),
						),
					);
				}

				span.setAttribute("employee.organizationId", targetEmployee.organizationId);
				span.setAttribute("requestedBy.userId", actor.session.user.id);

				yield* _(
					Effect.promise(() =>
						requestEmployeeWorkBalanceFullRebuild({
							employeeId: targetEmployee.id,
							organizationId: targetEmployee.organizationId,
						}),
					),
				);

				logger.info(
					{
						employeeId: targetEmployee.id,
						organizationId: targetEmployee.organizationId,
						requestedBy: actor.session.user.id,
					},
					"Employee work balance recalculation requested",
				);
			}),
	});
}
```

- [ ] **Step 4: Export the action through `actions.ts`**

Add import in `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`:

```ts
requestEmployeeWorkBalanceRecalculationAction,
```

Add export function:

```ts
export async function requestEmployeeWorkBalanceRecalculation(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return requestEmployeeWorkBalanceRecalculationAction(employeeId);
}
```

- [ ] **Step 5: Run action tests to verify they pass**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts' apps/webapp/src/lib/work-balance/service.ts
git commit -m "feat: request employee work balance recalculation"
```

---

### Task 6: Add Admin Recalculation UI

**Files:**

- Create: `apps/webapp/src/components/settings/work-balance-recalculation-card.tsx`
- Create: `apps/webapp/src/components/settings/work-balance-recalculation-card.test.tsx`
- Modify: `apps/webapp/src/lib/query/use-employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`

- [ ] **Step 1: Write failing card tests**

Create `apps/webapp/src/components/settings/work-balance-recalculation-card.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkBalanceRecalculationCard } from "./work-balance-recalculation-card";

const t = (_key: string, fallback: string) => fallback;

describe("WorkBalanceRecalculationCard", () => {
	it("requires confirmation before requesting recalculation", async () => {
		const onRecalculate = vi.fn().mockResolvedValue({ success: true });
		render(
			<WorkBalanceRecalculationCard
				employeeName="Ada Lovelace"
				isPending={false}
				onRecalculate={onRecalculate}
				t={t}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /recalculate work balance/i }));
		expect(onRecalculate).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: /confirm recalculation/i }));
		await waitFor(() => expect(onRecalculate).toHaveBeenCalledTimes(1));
	});

	it("disables actions while pending", () => {
		render(
			<WorkBalanceRecalculationCard
				employeeName="Ada Lovelace"
				isPending={true}
				onRecalculate={vi.fn()}
				t={t}
			/>,
		);

		expect(screen.getByRole("button", { name: /recalculation queued/i })).toBeDisabled();
	});
});
```

- [ ] **Step 2: Run UI test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/components/settings/work-balance-recalculation-card.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the card component**

Create `apps/webapp/src/components/settings/work-balance-recalculation-card.tsx`:

```tsx
"use client";

import { IconRefresh, IconShieldCheck } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Translate = (key: string, defaultValue: string, values?: Record<string, string>) => string;

export function WorkBalanceRecalculationCard({
	employeeName,
	isPending,
	onRecalculate,
	t,
}: {
	employeeName: string;
	isPending: boolean;
	onRecalculate: () => Promise<unknown>;
	t: Translate;
}) {
	const [confirming, setConfirming] = useState(false);

	async function handleConfirm() {
		await onRecalculate();
		setConfirming(false);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<IconShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
					<CardTitle>
						{t("settings.employees.workBalanceRecalculation.title", "Work balance maintenance")}
					</CardTitle>
				</div>
				<CardDescription>
					{t(
						"settings.employees.workBalanceRecalculation.description",
						"Queue a full rebuild of historical monthly and yearly work-balance aggregates for this employee.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.employees.workBalanceRecalculation.employeeHint",
						"This does not block the page. The worker will process the recalculation asynchronously for {employeeName}.",
						{ employeeName },
					)}
				</p>

				{confirming ? (
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button variant="secondary" onClick={() => setConfirming(false)} disabled={isPending}>
							{t("settings.employees.workBalanceRecalculation.cancel", "Cancel")}
						</Button>
						<Button onClick={handleConfirm} disabled={isPending}>
							<IconRefresh className="size-4" aria-hidden="true" />
							{t(
								"settings.employees.workBalanceRecalculation.confirm",
								"Confirm recalculation",
							)}
						</Button>
					</div>
				) : (
					<Button onClick={() => setConfirming(true)} disabled={isPending}>
						<IconRefresh className="size-4" aria-hidden="true" />
						{isPending
							? t(
								"settings.employees.workBalanceRecalculation.pending",
								"Recalculation queued",
							)
							: t(
								"settings.employees.workBalanceRecalculation.action",
								"Recalculate work balance",
							)}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Add TanStack mutation to `useEmployee`**

Modify imports in `apps/webapp/src/lib/query/use-employee.ts`:

```ts
import {
	type EmployeeWithRelations,
	getEmployee,
	listEmployeesForSelect,
	requestEmployeeWorkBalanceRecalculation,
	updateEmployee,
} from "@/app/[locale]/(app)/settings/employees/actions";
```

Add mutation after `updateMutation`:

```ts
const recalculateWorkBalanceMutation = useMutation({
	mutationFn: () => requestEmployeeWorkBalanceRecalculation(employeeId),
	onSuccess: (result) => {
		if (result.success) {
			queryClient.invalidateQueries({
				queryKey: queryKeys.employees.detail(employeeId),
			});
		}
	},
});
```

Add return fields:

```ts
requestWorkBalanceRecalculation: recalculateWorkBalanceMutation.mutateAsync,
isRequestingWorkBalanceRecalculation: recalculateWorkBalanceMutation.isPending,
```

- [ ] **Step 5: Render the card on employee detail page for org admins**

Modify imports in `employee-detail-page-client.tsx`:

```tsx
import { WorkBalanceRecalculationCard } from "@/components/settings/work-balance-recalculation-card";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
```

Destructure the mutation from `useEmployee`:

```ts
requestWorkBalanceRecalculation,
isRequestingWorkBalanceRecalculation,
```

Add handler before the `return`:

```ts
async function handleWorkBalanceRecalculation() {
	const result = await requestWorkBalanceRecalculation().catch(() => null);
	if (!result) {
		toast.error(t("settings.employees.workBalanceRecalculation.unexpectedError", "Could not queue recalculation"));
		return;
	}

	if (result.success) {
		toast.success(
			t("settings.employees.workBalanceRecalculation.success", "Work balance recalculation queued"),
		);
		return;
	}

	toast.error(
		result.error ??
			t("settings.employees.workBalanceRecalculation.failed", "Failed to queue recalculation"),
	);
}
```

Render after `EmployeeEmploymentHistoryCard`:

```tsx
{accessTier === "orgAdmin" && (
	<WorkBalanceRecalculationCard
		employeeName={buildAuthUserDisplayName(employee.user)}
		isPending={isRequestingWorkBalanceRecalculation}
		onRecalculate={handleWorkBalanceRecalculation}
		t={t}
	/>
)}
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm --filter webapp test src/components/settings/work-balance-recalculation-card.test.tsx 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx'
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/components/settings/work-balance-recalculation-card.tsx apps/webapp/src/components/settings/work-balance-recalculation-card.test.tsx apps/webapp/src/lib/query/use-employee.ts 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx'
git commit -m "feat: add work balance recalculation control"
```

---

### Task 7: Final Verification And Cleanup

**Files:**

- Review all files changed in Tasks 1-6.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/db/schema/__tests__/employee-work-balance-schema.test.ts src/lib/work-balance/periods.test.ts src/lib/work-balance/period-aggregation.test.ts src/lib/work-balance/service.test.ts src/lib/jobs/work-balance.test.ts 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts' src/components/settings/work-balance-recalculation-card.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full webapp test suite**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- apps/webapp/src/lib/work-balance apps/webapp/src/lib/jobs apps/webapp/src/db/schema apps/webapp/src/app/[locale]/\(app\)/settings/employees apps/webapp/src/components/settings docs/superpowers
```

Expected: Diff only contains the planned schema, worker, service, tests, and employee settings UI changes.

- [ ] **Step 5: Resolve verification failures through the owning task**

If Step 1, 2, or 3 fails, return to the task that owns the failing file, make the smallest fix there, rerun that task's test command, and use that task's commit step. If all verification passes, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: The plan covers the period aggregate schema, hot-window helpers, monthly period recomputation, worker dirty-range behavior, admin force recalculation, async UI, organization-scoped permission checks, migration safety notes, and targeted tests.
- Type consistency: The plan consistently uses `employeeWorkBalancePeriod`, `employee_work_balance_period`, `periodType`, `periodStart`, `periodEnd`, and `requestEmployeeWorkBalanceRecalculation`.
- Implementation risk handled in plan: Task 4 updates the read model from closed monthly history plus the hot window, and updates yearly buckets from closed monthly buckets when historical months change.
