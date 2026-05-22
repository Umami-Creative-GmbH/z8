# Absence-Adjusted Work Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved absences reduce required calendar hours, and `/calendar` plus `/time-tracking` show a cheap materialized all-time work balance refreshed every 3 hours.

**Architecture:** Keep visible calendar range summaries live by adjusting `dailyRequirements` before they reach existing UI summary builders. Add a separate all-time `employeeWorkBalance` table with dirty-state metadata, leaving the existing yearly `employeeTimeBalance` table intact for team yearly balance behavior. A BullMQ cron job runs every 3 hours, but it only processes dirty employees and a bounded batch of missing initial rows so the system scales to large organizations without repeatedly recomputing every employee.

**Tech Stack:** Next.js route handlers/server components, Drizzle ORM/Postgres, BullMQ cron registry, Luxon date handling, Vitest, Tolgee translations, React 19.

---

## Scalability Constraint

This plan intentionally avoids full recomputation for every employee on each cron run. At 20k users, the worker must process a bounded batch of employees whose balance is dirty or missing, then stop. Write paths mark affected employees dirty from the earliest changed date, and the 3-hour cron acts as reconciliation/backfill rather than a global all-history scan.

## File Structure

- Create `apps/webapp/src/lib/calendar/absence-adjusted-requirements.ts`: pure date/fraction helper that reduces policy requirements by approved absence ranges.
- Modify `apps/webapp/src/lib/calendar/work-policy-requirements.ts`: fetch approved absences and apply the shared helper for visible calendar ranges.
- Test `apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts`: full/half/multi-day/overlap/pending filtering behavior through pure inputs.
- Modify `apps/webapp/src/db/schema/time-tracking.ts`: add `employeeWorkBalance` for all-time materialized balances and dirty-state metadata without changing existing yearly `employeeTimeBalance`.
- Modify `apps/webapp/src/db/schema/relations.ts`: add relations for `employeeWorkBalance`.
- Create `apps/webapp/drizzle/0026_employee_work_balance.sql`: migration for the all-time materialized table.
- Modify `apps/webapp/drizzle/meta/_journal.json`: add the `0026_employee_work_balance` migration entry.
- Create `apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts`: schema and migration coverage.
- Create `apps/webapp/src/lib/work-balance/types.ts`: serializable work-balance payload type.
- Create `apps/webapp/src/lib/work-balance/format.ts`: signed duration formatter shared by calendar and time-tracking UI.
- Create `apps/webapp/src/lib/work-balance/service.ts`: DB reads/upserts, dirty marking, bounded employee selection, and all-time balance computation helpers.
- Test `apps/webapp/src/lib/work-balance/service.test.ts`: pure balance value helpers and failure aggregation behavior.
- Create `apps/webapp/src/lib/jobs/work-balance.ts`: cron processor that refreshes dirty employees plus a bounded initial-backfill batch.
- Modify `apps/webapp/src/lib/cron/registry.ts`: register `cron:work-balance` with `0 */3 * * *`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`: mark the current employee's all-time balance dirty after completed work-period changes.
- Modify `apps/webapp/src/lib/approvals/server/absence-approvals.ts`: mark the absence owner's all-time balance dirty after approve/reject decisions that affect approved absence coverage.
- Modify `apps/webapp/src/hooks/use-calendar-data.ts`: parse optional `workBalance` payload from `/api/calendar/events`.
- Modify `apps/webapp/src/app/api/calendar/events/route.ts`: load materialized balance for the scoped employee and include it in the response.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: render the all-time balance near the calendar controls/month summary area.
- Create `apps/webapp/src/components/work-balance/work-balance-card.tsx`: small reusable card/metric component for signed all-time balance.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts`: load current employee work balance.
- Modify `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`: render a fourth card for all-time balance.
- Test `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`: balance value and missing fallback.
- Update existing calendar tests where response shape changes: `apps/webapp/src/components/calendar/calendar-view.test.tsx`, `apps/webapp/src/app/api/calendar/events/route.test.ts`.

## Task 1: Pure Absence-Adjusted Requirement Helpers

**Files:**
- Create: `apps/webapp/src/lib/calendar/absence-adjusted-requirements.ts`
- Create: `apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DailyWorkRequirements } from "./types";
import { applyAbsenceAdjustmentsToRequirements, getAbsenceDayFraction } from "./absence-adjusted-requirements";

const baseRequirements: DailyWorkRequirements = {
	"2026-05-18": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
	"2026-05-19": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
	"2026-05-20": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
};

describe("getAbsenceDayFraction", () => {
	it("uses full day for same-day full-day absences", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			}),
		).toBe(1);
	});

	it("uses half day for same-day matching half-day absences", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			}),
		).toBe(0.5);
	});

	it("uses full day for same-day am-to-pm absences", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "pm",
			}),
		).toBe(1);
	});

	it("uses boundary half days and middle full days for multi-day absences", () => {
		const absence = {
			startDate: "2026-05-18",
			startPeriod: "pm" as const,
			endDate: "2026-05-20",
			endPeriod: "am" as const,
		};

		expect(getAbsenceDayFraction({ date: "2026-05-18", ...absence })).toBe(0.5);
		expect(getAbsenceDayFraction({ date: "2026-05-19", ...absence })).toBe(1);
		expect(getAbsenceDayFraction({ date: "2026-05-20", ...absence })).toBe(0.5);
	});
});

describe("applyAbsenceAdjustmentsToRequirements", () => {
	it("reduces approved full-day absences to zero required minutes", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(0);
		expect(adjusted["2026-05-19"]?.requiredMinutes).toBe(480);
	});

	it("reduces approved half-day absences by 50 percent", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(240);
	});

	it("caps overlapping absence reductions at 100 percent", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			},
			{
				startDate: "2026-05-18",
				startPeriod: "pm",
				endDate: "2026-05-18",
				endPeriod: "pm",
			},
			{
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(0);
	});

	it("does not mutate the original requirements object", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			},
		]);

		expect(baseRequirements["2026-05-18"]?.requiredMinutes).toBe(480);
		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(0);
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts`

Expected: FAIL because `./absence-adjusted-requirements` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `apps/webapp/src/lib/calendar/absence-adjusted-requirements.ts`:

```ts
import { DateTime } from "luxon";
import type { DailyWorkRequirements } from "./types";

export type AbsenceDayPeriod = "full_day" | "am" | "pm";

export interface ApprovedAbsenceRange {
	startDate: string;
	startPeriod: AbsenceDayPeriod;
	endDate: string;
	endPeriod: AbsenceDayPeriod;
}

interface AbsenceDayFractionInput extends ApprovedAbsenceRange {
	date: string;
}

export function getAbsenceDayFraction(input: AbsenceDayFractionInput): number {
	if (input.startDate === input.endDate) {
		if (input.startPeriod === "full_day" || input.endPeriod === "full_day") return 1;
		return input.startPeriod === input.endPeriod ? 0.5 : 1;
	}

	if (input.date === input.startDate) return input.startPeriod === "pm" ? 0.5 : 1;
	if (input.date === input.endDate) return input.endPeriod === "am" ? 0.5 : 1;
	return 1;
}

function eachAbsenceDate(absence: ApprovedAbsenceRange): string[] {
	const dates: string[] = [];
	let cursor = DateTime.fromISO(absence.startDate, { zone: "utc" }).startOf("day");
	const end = DateTime.fromISO(absence.endDate, { zone: "utc" }).startOf("day");
	if (!cursor.isValid || !end.isValid || end < cursor) return dates;

	while (cursor <= end) {
		const dateKey = cursor.toISODate();
		if (dateKey) dates.push(dateKey);
		cursor = cursor.plus({ days: 1 });
	}

	return dates;
}

export function applyAbsenceAdjustmentsToRequirements(
	requirements: DailyWorkRequirements,
	absences: ApprovedAbsenceRange[],
): DailyWorkRequirements {
	const reductionByDate = new Map<string, number>();

	for (const absence of absences) {
		for (const date of eachAbsenceDate(absence)) {
			if (!requirements[date]) continue;
			const current = reductionByDate.get(date) ?? 0;
			const next = current + getAbsenceDayFraction({ date, ...absence });
			reductionByDate.set(date, Math.min(1, next));
		}
	}

	const adjusted: DailyWorkRequirements = {};
	for (const [dateKey, requirement] of Object.entries(requirements)) {
		const reduction = reductionByDate.get(dateKey) ?? 0;
		adjusted[dateKey] = {
			...requirement,
			requiredMinutes: Math.max(0, Math.round(requirement.requiredMinutes * (1 - reduction))),
		};
	}

	return adjusted;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `pnpm --filter webapp test apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit helper**

```bash
git add apps/webapp/src/lib/calendar/absence-adjusted-requirements.ts apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts
git commit -m "feat: add absence adjusted requirement helpers"
```

## Task 2: Apply Approved Absences To Calendar Daily Requirements

**Files:**
- Modify: `apps/webapp/src/lib/calendar/work-policy-requirements.ts`
- Modify: `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

- [ ] **Step 1: Add tests for adjusted daily requirements**

Modify the import in `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`:

```ts
import { applyApprovedAbsencesToDailyRequirements, buildDailyWorkRequirements } from "./work-policy-requirements";
```

Append these tests inside `describe("buildDailyWorkRequirements", () => { ... })` after the existing tests:

```ts
	it("applies approved full-day absence reductions to daily requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
				homeOfficeDaysPerCycle: 0,
				days: [],
			}),
			startDate: new Date("2026-05-18T00:00:00.000Z"),
			endDate: new Date("2026-05-18T23:59:59.999Z"),
		});

		expect(
			applyApprovedAbsencesToDailyRequirements(requirements, [
				{
					startDate: "2026-05-18",
					startPeriod: "full_day",
					endDate: "2026-05-18",
					endPeriod: "full_day",
				},
			]),
		).toEqual({
			"2026-05-18": {
				requiredMinutes: 0,
				policyId: "policy-1",
				policyName: "Standard Hours",
			},
		});
	});

	it("applies approved half-day absence reductions to daily requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				hoursPerCycle: null,
				homeOfficeDaysPerCycle: 0,
				days: [{ dayOfWeek: "monday", hoursPerDay: "8", isWorkDay: true }],
			}),
			startDate: new Date("2026-05-18T00:00:00.000Z"),
			endDate: new Date("2026-05-18T23:59:59.999Z"),
		});

		const adjusted = applyApprovedAbsencesToDailyRequirements(requirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "pm",
				endDate: "2026-05-18",
				endPeriod: "pm",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(240);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

Expected: FAIL because `applyApprovedAbsencesToDailyRequirements` is not exported.

- [ ] **Step 3: Wire the helper and approved absence query**

Modify `apps/webapp/src/lib/calendar/work-policy-requirements.ts` imports:

```ts
import { and, eq, gte, lte } from "drizzle-orm";
import { absenceCategory, absenceEntry, employee } from "@/db/schema";
import {
	applyAbsenceAdjustmentsToRequirements,
	type ApprovedAbsenceRange,
} from "./absence-adjusted-requirements";
```

Add this exported wrapper near `buildDailyWorkRequirements`:

```ts
export function applyApprovedAbsencesToDailyRequirements(
	requirements: DailyWorkRequirements,
	absences: ApprovedAbsenceRange[],
): DailyWorkRequirements {
	return applyAbsenceAdjustmentsToRequirements(requirements, absences);
}
```

Add this function before `getDailyWorkRequirementsForEmployee`:

```ts
async function getApprovedAbsenceRanges(params: {
	database: DatabaseService;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
}): Promise<ApprovedAbsenceRange[]> {
	const start = DateTime.fromJSDate(params.startDate).toFormat("yyyy-MM-dd");
	const end = DateTime.fromJSDate(params.endDate).toFormat("yyyy-MM-dd");

	return params.database.query("getApprovedAbsencesForCalendarRequirements", async () => {
		return params.database.db
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
					eq(absenceEntry.employeeId, params.employeeId),
					eq(absenceEntry.organizationId, params.organizationId),
					eq(absenceEntry.status, "approved"),
					eq(absenceCategory.organizationId, params.organizationId),
					eq(absenceCategory.requiresWorkTime, false),
					lte(absenceEntry.startDate, end),
					gte(absenceEntry.endDate, start),
				),
			);
	});
}
```

Replace the final `return buildDailyWorkRequirements({ ... })` in `getDailyWorkRequirementsForEmployee` with:

```ts
			const requirements = buildDailyWorkRequirements({
				policy,
				startDate: params.startDate,
				endDate: params.endDate,
			});
			const approvedAbsences = yield* _(
				Effect.promise(() =>
					getApprovedAbsenceRanges({
						database,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						startDate: params.startDate,
						endDate: params.endDate,
					}),
				),
			);

			return applyApprovedAbsencesToDailyRequirements(requirements, approvedAbsences);
```

- [ ] **Step 4: Run requirement tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/calendar/work-policy-requirements.test.ts apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit calendar adjustment**

```bash
git add apps/webapp/src/lib/calendar/work-policy-requirements.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts
git commit -m "feat: adjust calendar requirements for approved absences"
```

## Task 3: Add All-Time Employee Work Balance Schema

**Files:**
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/drizzle/0026_employee_work_balance.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Create: `apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employee } from "../organization";
import { employeeWorkBalance } from "../time-tracking";

const migration0026Url = new URL(
	"../../../../drizzle/0026_employee_work_balance.sql",
	import.meta.url,
);
const migrationJournal = JSON.parse(
	readFileSync(new URL("../../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

describe("employee work balance schema", () => {
	it("defines organization-scoped all-time balance columns", () => {
		expect(employeeWorkBalance.organizationId.name).toBe("organization_id");
		expect(employeeWorkBalance.employeeId.name).toBe("employee_id");
		expect(employeeWorkBalance.actualMinutes.name).toBe("actual_minutes");
		expect(employeeWorkBalance.requiredMinutes.name).toBe("required_minutes");
		expect(employeeWorkBalance.balanceMinutes.name).toBe("balance_minutes");
		expect(employeeWorkBalance.computedFromDate.name).toBe("computed_from_date");
		expect(employeeWorkBalance.computedThroughDate.name).toBe("computed_through_date");
		expect(employeeWorkBalance.computedAt.name).toBe("computed_at");
		expect(employeeWorkBalance.isDirty.name).toBe("is_dirty");
		expect(employeeWorkBalance.dirtyFromDate.name).toBe("dirty_from_date");
		expect(employeeWorkBalance.refreshRequestedAt.name).toBe("refresh_requested_at");
		expect(employeeWorkBalance.lastError.name).toBe("last_error");
	});

	it("enforces employee and organization consistency", () => {
		const foreignKeys = getTableConfig(employeeWorkBalance).foreignKeys.map((foreignKey) =>
			foreignKey.reference(),
		);

		expect(
			foreignKeys.some((reference) => {
				return (
					reference.columns.length === 2 &&
					reference.columns[0]?.name === "employee_id" &&
					reference.columns[1]?.name === "organization_id" &&
					reference.foreignColumns.length === 2 &&
					reference.foreignColumns[0]?.table === employee &&
					reference.foreignColumns[0]?.name === "id" &&
					reference.foreignColumns[1]?.table === employee &&
					reference.foreignColumns[1]?.name === "organization_id"
				);
			}),
		).toBe(true);
	});

	it("includes a migration for the all-time balance table", () => {
		expect(existsSync(migration0026Url)).toBe(true);

		const migration = readFileSync(migration0026Url, "utf8");
		expect(migration).toContain('CREATE TABLE "employee_work_balance"');
		expect(migration).toContain(
			'CREATE UNIQUE INDEX "employeeWorkBalance_org_employee_idx"',
		);
		expect(migration).toContain(
			'CREATE INDEX "employeeWorkBalance_dirty_idx"',
		);
		expect(migration).toContain(
			'FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade',
		);
		expect(migrationJournal.entries).toContainEqual(
			expect.objectContaining({ idx: 26, tag: "0026_employee_work_balance" }),
		);
	});
});
```

- [ ] **Step 2: Run schema test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts`

Expected: FAIL because `employeeWorkBalance` and migration `0026_employee_work_balance.sql` do not exist.

- [ ] **Step 3: Add schema table**

Modify imports in `apps/webapp/src/db/schema/time-tracking.ts` to include `date`:

```ts
import {
	boolean,
	date,
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

Append this after the existing `employeeTimeBalance` table:

```ts
export const employeeWorkBalance = pgTable(
	"employee_work_balance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		actualMinutes: integer("actual_minutes").notNull(),
		requiredMinutes: integer("required_minutes").notNull(),
		balanceMinutes: integer("balance_minutes").notNull(),
		computedFromDate: date("computed_from_date").notNull(),
		computedThroughDate: date("computed_through_date").notNull(),
		computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
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
		uniqueIndex("employeeWorkBalance_org_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
		index("employeeWorkBalance_org_idx").on(table.organizationId),
		index("employeeWorkBalance_employee_org_idx").on(table.employeeId, table.organizationId),
		index("employeeWorkBalance_dirty_idx").on(table.isDirty, table.refreshRequestedAt),
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
```

- [ ] **Step 4: Add relations**

Modify the `time-tracking` import in `apps/webapp/src/db/schema/relations.ts`:

```ts
import { employeeTimeBalance, employeeWorkBalance, timeEntry, workPeriod } from "./time-tracking";
```

In `organizationRelations`, add a relation beside `timeBalances`:

```ts
	workBalances: many(employeeWorkBalance),
```

In `employeeRelations`, add a relation beside existing time-balance relations:

```ts
	workBalance: one(employeeWorkBalance),
```

Append this relation near `employeeTimeBalanceRelations`:

```ts
export const employeeWorkBalanceRelations = relations(employeeWorkBalance, ({ one }) => ({
	employee: one(employee, {
		fields: [employeeWorkBalance.employeeId],
		references: [employee.id],
	}),
	organization: one(organization, {
		fields: [employeeWorkBalance.organizationId],
		references: [organization.id],
	}),
}));
```

- [ ] **Step 5: Add SQL migration and journal entry**

Create `apps/webapp/drizzle/0026_employee_work_balance.sql`:

```sql
CREATE TABLE "employee_work_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"actual_minutes" integer NOT NULL,
	"required_minutes" integer NOT NULL,
	"balance_minutes" integer NOT NULL,
	"computed_from_date" date NOT NULL,
	"computed_through_date" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"dirty_from_date" date,
	"refresh_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD CONSTRAINT "employee_work_balance_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD CONSTRAINT "employee_work_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD CONSTRAINT "employee_work_balance_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "employeeWorkBalance_org_employee_idx" ON "employee_work_balance" USING btree ("organization_id","employee_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalance_org_idx" ON "employee_work_balance" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalance_employee_org_idx" ON "employee_work_balance" USING btree ("employee_id","organization_id");
--> statement-breakpoint
CREATE INDEX "employeeWorkBalance_dirty_idx" ON "employee_work_balance" USING btree ("is_dirty","refresh_requested_at");
```

Append this object to `apps/webapp/drizzle/meta/_journal.json` after the current highest index entry:

```json
{
  "idx": 26,
  "version": "7",
  "when": 1778889600000,
  "tag": "0026_employee_work_balance",
  "breakpoints": true
}
```

- [ ] **Step 6: Run schema test**

Run: `pnpm --filter webapp test apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts apps/webapp/src/db/schema/__tests__/employee-time-balance-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit schema**

```bash
git add apps/webapp/src/db/schema/time-tracking.ts apps/webapp/src/db/schema/relations.ts apps/webapp/drizzle/0026_employee_work_balance.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts
git commit -m "feat: add employee work balance schema"
```

## Task 4: Work Balance Service And Cron Processor

**Files:**
- Create: `apps/webapp/src/lib/work-balance/types.ts`
- Create: `apps/webapp/src/lib/work-balance/format.ts`
- Create: `apps/webapp/src/lib/work-balance/service.ts`
- Create: `apps/webapp/src/lib/work-balance/service.test.ts`
- Create: `apps/webapp/src/lib/jobs/work-balance.ts`
- Modify: `apps/webapp/src/lib/cron/registry.ts`

- [ ] **Step 1: Write service tests**

Create `apps/webapp/src/lib/work-balance/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "./format";
import { buildWorkBalanceValues } from "./service";

describe("work balance helpers", () => {
	it("builds all-time work balance values", () => {
		const computedAt = new Date("2026-05-22T12:00:00.000Z");

		expect(
			buildWorkBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				actualMinutes: 2520,
				requiredMinutes: 2400,
				computedFromDate: "2026-05-01",
				computedThroughDate: "2026-05-22",
				computedAt,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
			updatedAt: computedAt,
			isDirty: false,
			dirtyFromDate: null,
			refreshRequestedAt: null,
			lastError: null,
		});
	});

	it("formats signed all-time work balance values", () => {
		expect(formatSignedWorkBalance(750)).toBe("+12:30h");
		expect(formatSignedWorkBalance(-255)).toBe("-4:15h");
		expect(formatSignedWorkBalance(0)).toBe("0:00h");
	});

	it("classifies positive zero and negative balances", () => {
		expect(getWorkBalanceStatus(1)).toBe("positive");
		expect(getWorkBalanceStatus(0)).toBe("neutral");
		expect(getWorkBalanceStatus(-1)).toBe("negative");
	});
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/work-balance/service.test.ts`

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Add shared work-balance types and formatting**

Create `apps/webapp/src/lib/work-balance/types.ts`:

```ts
export interface EmployeeWorkBalancePayload {
	employeeId: string;
	organizationId: string;
	actualMinutes: number;
	requiredMinutes: number;
	balanceMinutes: number;
	computedFromDate: string;
	computedThroughDate: string;
	computedAt: Date;
}

export type WorkBalanceStatus = "positive" | "neutral" | "negative";
```

Create `apps/webapp/src/lib/work-balance/format.ts`:

```ts
import type { WorkBalanceStatus } from "./types";

export function formatSignedWorkBalance(balanceMinutes: number): string {
	if (balanceMinutes === 0) return "0:00h";
	const sign = balanceMinutes > 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(balanceMinutes);
	const hours = Math.floor(absoluteMinutes / 60);
	const minutes = absoluteMinutes % 60;
	return `${sign}${hours}:${String(minutes).padStart(2, "0")}h`;
}

export function getWorkBalanceStatus(balanceMinutes: number): WorkBalanceStatus {
	if (balanceMinutes > 0) return "positive";
	if (balanceMinutes < 0) return "negative";
	return "neutral";
}
```

- [ ] **Step 4: Add service implementation**

Create `apps/webapp/src/lib/work-balance/service.ts`:

```ts
import { and, asc, eq, gte, isNotNull, isNull, lte, min, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceEntry, employee, employeeWorkBalance, workPeriod } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import type { EmployeeWorkBalancePayload } from "./types";

export function buildWorkBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	actualMinutes: number;
	requiredMinutes: number;
	computedFromDate: string;
	computedThroughDate: string;
	computedAt: Date;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		actualMinutes: input.actualMinutes,
		requiredMinutes: input.requiredMinutes,
		balanceMinutes: input.actualMinutes - input.requiredMinutes,
		computedFromDate: input.computedFromDate,
		computedThroughDate: input.computedThroughDate,
		computedAt: input.computedAt,
		isDirty: false,
		dirtyFromDate: null,
		refreshRequestedAt: null,
		lastError: null,
		updatedAt: input.computedAt,
	};
}

export async function getEmployeeWorkBalance(input: {
	employeeId: string;
	organizationId: string;
}): Promise<EmployeeWorkBalancePayload | null> {
	const row = await db.query.employeeWorkBalance.findFirst({
		where: and(
			eq(employeeWorkBalance.employeeId, input.employeeId),
			eq(employeeWorkBalance.organizationId, input.organizationId),
		),
	});

	return row ?? null;
}
```

Continue in the same file with DB-backed compute/upsert helpers:

```ts
async function getFirstRelevantDate(input: {
	employeeId: string;
	organizationId: string;
}): Promise<string | null> {
	const [firstWorkPeriod] = await db
		.select({ value: min(workPeriod.startTime) })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
			),
		);

	const [firstAbsence] = await db
		.select({ value: min(absenceEntry.startDate) })
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.status, "approved"),
			),
		);

	const workDate = firstWorkPeriod?.value
		? DateTime.fromJSDate(firstWorkPeriod.value, { zone: "utc" }).toISODate()
		: null;
	const absenceDate = firstAbsence?.value ?? null;
	const dates = [workDate, absenceDate].filter((value): value is string => Boolean(value));
	if (dates.length === 0) return null;
	return dates.sort()[0]!;
}

async function getActualMinutes(input: {
	employeeId: string;
	organizationId: string;
	startDate: Date;
	endDate: Date;
}): Promise<number> {
	const [row] = await db
		.select({ totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)` })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, input.startDate),
				lte(workPeriod.startTime, input.endDate),
			),
		);

	return Number(row?.totalMinutes ?? 0);
}

export async function computeEmployeeWorkBalance(input: {
	employeeId: string;
	organizationId: string;
	now?: Date;
}) {
	const firstDate = await getFirstRelevantDate(input);
	if (!firstDate) return null;

	const through = DateTime.fromJSDate(input.now ?? new Date(), { zone: "utc" }).startOf("day");
	const start = DateTime.fromISO(firstDate, { zone: "utc" }).startOf("day");
	const startDate = start.toJSDate();
	const endDate = through.endOf("day").toJSDate();

	const [actualMinutes, requirements] = await Promise.all([
		getActualMinutes({ ...input, startDate, endDate }),
		getDailyWorkRequirementsForEmployee({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			startDate,
			endDate,
		}),
	]);

	const requiredMinutes = Object.values(requirements).reduce(
		(total, requirement) => total + requirement.requiredMinutes,
		0,
	);

	return buildWorkBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		actualMinutes,
		requiredMinutes,
		computedFromDate: start.toISODate()!,
		computedThroughDate: through.toISODate()!,
		computedAt: input.now ?? new Date(),
	});
}

export async function upsertEmployeeWorkBalance(values: ReturnType<typeof buildWorkBalanceValues>) {
	await db
		.insert(employeeWorkBalance)
		.values(values)
		.onConflictDoUpdate({
			target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
			set: {
				actualMinutes: values.actualMinutes,
				requiredMinutes: values.requiredMinutes,
				balanceMinutes: values.balanceMinutes,
				computedFromDate: values.computedFromDate,
				computedThroughDate: values.computedThroughDate,
				computedAt: values.computedAt,
				isDirty: false,
				dirtyFromDate: null,
				refreshRequestedAt: null,
				lastError: null,
				updatedAt: values.updatedAt,
			},
		});
}

export async function markEmployeeWorkBalanceDirty(input: {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string;
}) {
	const requestedAt = new Date();
	const dirtyFromDate = input.dirtyFromDate ?? null;
	await db
		.insert(employeeWorkBalance)
		.values({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: dirtyFromDate ?? "1970-01-01",
			computedThroughDate: dirtyFromDate ?? "1970-01-01",
			computedAt: requestedAt,
			isDirty: true,
			dirtyFromDate,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		})
		.onConflictDoUpdate({
			target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
			set: {
				isDirty: true,
				dirtyFromDate: dirtyFromDate
					? sql`case when ${employeeWorkBalance.dirtyFromDate} is null or ${employeeWorkBalance.dirtyFromDate} > ${dirtyFromDate} then ${dirtyFromDate} else ${employeeWorkBalance.dirtyFromDate} end`
					: sql`${employeeWorkBalance.dirtyFromDate}`,
				refreshRequestedAt: requestedAt,
				updatedAt: requestedAt,
			},
		});
}

export async function markEmployeeWorkBalanceFailed(input: {
	employeeId: string;
	organizationId: string;
	error: string;
}) {
	await db
		.update(employeeWorkBalance)
		.set({ lastError: input.error, updatedAt: new Date() })
		.where(
			and(
				eq(employeeWorkBalance.employeeId, input.employeeId),
				eq(employeeWorkBalance.organizationId, input.organizationId),
			),
		);
}

export async function listEmployeesForWorkBalanceBatch(limit = 1000) {
	return db
		.select({ id: employee.id, organizationId: employee.organizationId })
		.from(employee)
		.leftJoin(
			employeeWorkBalance,
			and(
				eq(employeeWorkBalance.employeeId, employee.id),
				eq(employeeWorkBalance.organizationId, employee.organizationId),
			),
		)
		.where(
			and(
				isNotNull(employee.organizationId),
				or(isNull(employeeWorkBalance.id), eq(employeeWorkBalance.isDirty, true)),
			),
		)
		.orderBy(asc(employeeWorkBalance.refreshRequestedAt), asc(employee.id))
		.limit(limit);
}
```

- [ ] **Step 5: Add cron processor**

Create `apps/webapp/src/lib/jobs/work-balance.ts`:

```ts
import { createLogger } from "@/lib/logger";
import {
	computeEmployeeWorkBalance,
	listEmployeesForWorkBalanceBatch,
	markEmployeeWorkBalanceFailed,
	upsertEmployeeWorkBalance,
} from "@/lib/work-balance/service";

const logger = createLogger("WorkBalanceJob");

export interface WorkBalanceJobResult {
	success: boolean;
	employeesProcessed: number;
	balancesUpdated: number;
	skipped: number;
	batchLimit: number;
	errors: Array<{ employeeId: string; organizationId: string; error: string }>;
}

export async function runWorkBalanceRefresh(): Promise<WorkBalanceJobResult> {
	const batchLimit = 1000;
	const employees = await listEmployeesForWorkBalanceBatch(batchLimit);
	const result: WorkBalanceJobResult = {
		success: true,
		employeesProcessed: 0,
		balancesUpdated: 0,
		skipped: 0,
		batchLimit,
		errors: [],
	};

	for (const employee of employees) {
		result.employeesProcessed += 1;
		try {
			const values = await computeEmployeeWorkBalance({
				employeeId: employee.id,
				organizationId: employee.organizationId,
			});
			if (!values) {
				result.skipped += 1;
				continue;
			}

			await upsertEmployeeWorkBalance(values);
			result.balancesUpdated += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error: message, employeeId: employee.id }, "Failed to refresh employee work balance");
			await markEmployeeWorkBalanceFailed({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				error: message,
			});
			result.errors.push({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				error: message,
			});
		}
	}

	result.success = result.errors.length === 0;
	return result;
}
```

- [ ] **Step 6: Register cron job**

In `apps/webapp/src/lib/cron/registry.ts`, add a result interface near other result interfaces:

```ts
export interface WorkBalanceRefreshResult {
	success: boolean;
	employeesProcessed: number;
	balancesUpdated: number;
	skipped: number;
	batchLimit: number;
	errors: Array<{ employeeId: string; organizationId: string; error: string }>;
}
```

Add this entry to `CRON_JOBS`:

```ts
	"cron:work-balance": {
		schedule: "0 */3 * * *",
		description: "Refresh materialized all-time employee work balances",
		processor: async () => {
			const { runWorkBalanceRefresh } = await import("@/lib/jobs/work-balance");
			return runWorkBalanceRefresh();
		},
		defaultJobOptions: { attempts: 2, priority: 5 },
	},
```

- [ ] **Step 7: Run service tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/work-balance/service.test.ts`

Expected: PASS.

- [ ] **Step 8: Typecheck targeted files**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: PASS, or only pre-existing unrelated errors. If new errors mention files changed in this task, fix those errors before committing.

- [ ] **Step 9: Commit service and worker**

```bash
git add apps/webapp/src/lib/work-balance apps/webapp/src/lib/jobs/work-balance.ts apps/webapp/src/lib/cron/registry.ts
git commit -m "feat: refresh all-time work balances"
```

## Task 5: Dirty Marking Hooks For Incremental Refresh

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`

- [ ] **Step 1: Add dirty marking to time-tracking actions**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`, add this import near other library imports:

```ts
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
```

In `clockOut`, after the work period is updated with `endTime`, `durationMinutes`, and `isActive: false`, add:

```ts
await markEmployeeWorkBalanceDirty({
	employeeId: emp.id,
	organizationId: emp.organizationId,
	dirtyFromDate: DateTime.fromJSDate(activePeriod.startTime, { zone: "utc" }).toISODate() ?? undefined,
});
```

In `createManualTimeEntry`, after the completed work period insert succeeds, add:

```ts
await markEmployeeWorkBalanceDirty({
	employeeId: emp.id,
	organizationId: emp.organizationId,
	dirtyFromDate: DateTime.fromJSDate(clockInDate, { zone: "utc" }).toISODate() ?? undefined,
});
```

In `deleteWorkPeriod`, after the work period and associated time entries are marked superseded/deleted, add:

```ts
await markEmployeeWorkBalanceDirty({
	employeeId: period.employeeId,
	organizationId: period.organizationId,
	dirtyFromDate: DateTime.fromJSDate(period.startTime, { zone: "utc" }).toISODate() ?? undefined,
});
```

In `updateWorkPeriodProject` and `updateWorkPeriodNotes`, do not mark the balance dirty because project and note changes do not change actual or required minutes.

- [ ] **Step 2: Add dirty marking to absence approvals**

In `apps/webapp/src/lib/approvals/server/absence-approvals.ts`, add this import near other library imports:

```ts
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
```

In `updateAbsenceStatus`, load the previous row before the update:

```ts
const previousAbsence = await dbService.db.query.absenceEntry.findFirst({
	where: eq(absenceEntry.id, entityId),
	columns: {
		employeeId: true,
		organizationId: true,
		startDate: true,
		status: true,
	},
});
```

After the existing `findFirst` that returns the updated absence, store it in a local `updatedAbsence` variable and mark dirty before returning:

```ts
const updatedAbsence = await dbService.db.query.absenceEntry.findFirst({
	where: eq(absenceEntry.id, entityId),
	with: {
		category: true,
		employee: { with: { user: true } },
	},
});

if (
	updatedAbsence?.organizationId &&
	(status === "approved" || previousAbsence?.status === "approved")
) {
	await markEmployeeWorkBalanceDirty({
		employeeId: updatedAbsence.employeeId,
		organizationId: updatedAbsence.organizationId,
		dirtyFromDate: updatedAbsence.startDate,
	});
}

return updatedAbsence;
```

- [ ] **Step 3: Run targeted dirty-marking typecheck**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: PASS, or only pre-existing unrelated errors. If new errors mention `actions.ts`, `absence-approvals.ts`, or `work-balance/service.ts`, fix those errors before committing.

- [ ] **Step 4: Commit dirty marking hooks**

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts apps/webapp/src/lib/approvals/server/absence-approvals.ts
git commit -m "feat: mark work balances dirty on time changes"
```

## Task 6: Calendar API And UI Balance Read

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Modify: `apps/webapp/src/app/api/calendar/events/route.test.ts`
- Modify: `apps/webapp/src/hooks/use-calendar-data.ts`
- Create: `apps/webapp/src/components/work-balance/work-balance-card.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Extend calendar API test mocks**

In `apps/webapp/src/app/api/calendar/events/route.test.ts`, add `getEmployeeWorkBalance` to `mockState`:

```ts
getEmployeeWorkBalance: vi.fn(async () => null),
```

Add this mock after the work-policy mock:

```ts
vi.mock("@/lib/work-balance/service", () => ({
	getEmployeeWorkBalance: mockState.getEmployeeWorkBalance,
}));
```

Append this test:

```ts
	it("returns materialized work balance for the scoped employee", async () => {
		mockState.getEmployeeWorkBalance.mockResolvedValueOnce({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt: new Date("2026-05-22T12:00:00.000Z"),
		});

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(mockState.getEmployeeWorkBalance).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
		});
		expect(body.workBalance).toMatchObject({
			balanceMinutes: 120,
			actualMinutes: 2520,
			requiredMinutes: 2400,
		});
	});
```

- [ ] **Step 2: Run API test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/app/api/calendar/events/route.test.ts`

Expected: FAIL because the route does not read or return `workBalance`.

- [ ] **Step 3: Add API work-balance read**

In `apps/webapp/src/app/api/calendar/events/route.ts`, import:

```ts
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
```

Add a local variable near `events`:

```ts
let workBalance = null;
```

After `dailyRequirements = await fetchDailyRequirements(...)`, add:

```ts
		if (scopedEmployeeId) {
			try {
				workBalance = await getEmployeeWorkBalance({
					organizationId,
					employeeId: scopedEmployeeId,
				});
			} catch (error) {
				console.error("Error fetching calendar work balance:", error);
				workBalance = null;
			}
		}
```

Include `workBalance` in `superJsonResponse`:

```ts
		return superJsonResponse({
			events,
			total: events.length,
			dailyRequirements,
			dailyActualMinutes,
			workBalance,
		});
```

- [ ] **Step 4: Parse work balance in `useCalendarData`**

In `apps/webapp/src/hooks/use-calendar-data.ts`, import the payload type:

```ts
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
```

Add `workBalance: EmployeeWorkBalancePayload | null;` to calendar data interfaces.

In the SuperJSON parse result, include:

```ts
workBalance: (data.workBalance ?? null) as EmployeeWorkBalancePayload | null,
```

Change the default `calendarData` fallback to:

```ts
data: calendarData = { events: [], dailyRequirements: {}, dailyActualMinutes: {}, workBalance: null },
```

Return `workBalance: calendarData.workBalance` from the hook.

- [ ] **Step 5: Add reusable work-balance card**

Create `apps/webapp/src/components/work-balance/work-balance-card.tsx`:

```tsx
"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "@/lib/work-balance/format";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

interface WorkBalanceCardProps {
	balance: EmployeeWorkBalancePayload | null;
	compact?: boolean;
}

export function WorkBalanceCard({ balance, compact = false }: WorkBalanceCardProps) {
	const { t } = useTranslate();
	const status = balance ? getWorkBalanceStatus(balance.balanceMinutes) : "neutral";

	return (
		<Card className={compact ? "min-w-52" : undefined}>
			<CardHeader className={compact ? "p-3" : undefined}>
				<CardDescription>{t("workBalance.label", "All-time balance")}</CardDescription>
				<CardTitle
					className={cn(
						"tabular-nums text-2xl",
						status === "positive" && "text-emerald-600 dark:text-emerald-400",
						status === "negative" && "text-destructive",
					)}
				>
					{balance
						? formatSignedWorkBalance(balance.balanceMinutes)
						: t("workBalance.notCalculated", "Not calculated yet")}
				</CardTitle>
				<p className="text-muted-foreground text-xs">
					{balance?.computedAt
						? t("workBalance.updatedEveryThreeHours", "Updated every 3 hours")
						: t("workBalance.pendingDescription", "The worker will calculate this balance soon.")}
				</p>
			</CardHeader>
		</Card>
	);
}
```

- [ ] **Step 6: Render card in calendar view**

In `apps/webapp/src/components/calendar/calendar-view.tsx`, import:

```tsx
import { WorkBalanceCard } from "@/components/work-balance/work-balance-card";
```

Destructure `workBalance` from `useCalendarData`:

```tsx
const { events, dailyRequirements, dailyActualMinutes, workBalance, isLoading, error, refetch } =
	useCalendarData({ ... });
```

Render the compact card near existing calendar controls before the calendar body:

```tsx
<div className="px-4 lg:px-6">
	<WorkBalanceCard balance={workBalance} compact />
</div>
```

- [ ] **Step 7: Run calendar tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/components/calendar/calendar-view.test.tsx`

Expected: PASS after updating any existing mock default data in `calendar-view.test.tsx` to include `workBalance: null`.

- [ ] **Step 8: Commit calendar balance UI**

```bash
git add apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/hooks/use-calendar-data.ts apps/webapp/src/components/work-balance/work-balance-card.tsx apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "feat: show work balance on calendar"
```

## Task 7: Time-Tracking All-Time Balance Card

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts`
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`
- Create: `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`

- [ ] **Step 1: Write component test**

Create `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklySummaryCards } from "./weekly-summary-cards";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const summary = {
	todayMinutes: 120,
	weekMinutes: 600,
	monthMinutes: 1800,
};

describe("WeeklySummaryCards", () => {
	it("renders all-time work balance as a fourth summary card", () => {
		render(
			<WeeklySummaryCards
				summary={summary}
				workBalance={{
					employeeId: "employee-1",
					organizationId: "org-1",
					actualMinutes: 2520,
					requiredMinutes: 2400,
					balanceMinutes: 120,
					computedFromDate: "2026-05-01",
					computedThroughDate: "2026-05-22",
					computedAt: new Date("2026-05-22T12:00:00.000Z"),
				}}
			/>,
		);

		expect(screen.getByText("All-time balance")).toBeInTheDocument();
		expect(screen.getByText("+2:00h")).toBeInTheDocument();
	});

	it("renders a missing-balance fallback", () => {
		render(<WeeklySummaryCards summary={summary} workBalance={null} />);

		expect(screen.getByText("Not calculated yet")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run component test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`

Expected: FAIL because `WeeklySummaryCards` does not accept `workBalance`.

- [ ] **Step 3: Load work balance in page data**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts`, import:

```ts
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
```

Add `workBalance` to the `Promise.all` call:

```ts
const [activeWorkPeriod, workPeriods, summary, t, timelineResult, workBalance] = await Promise.all([
	getActiveWorkPeriod(currentEmployee.id),
	getWorkPeriods(currentEmployee.id, startDate, endDate),
	getTimeSummary(currentEmployee.id, timezone, weekStartDay),
	getTranslate(),
	getWorkdayTimelineData({
		employeeId: currentEmployee.id,
		organizationId: currentEmployee.organizationId,
		timezone,
		timeFormat,
		dateParam: searchParams.date,
	}),
	getEmployeeWorkBalance({
		employeeId: currentEmployee.id,
		organizationId: currentEmployee.organizationId,
	}),
]);
```

Return `workBalance` from `getTimeTrackingPageData`.

- [ ] **Step 4: Pass balance to summary cards**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`, change:

```tsx
<WeeklySummaryCards summary={pageData.summary} />
```

to:

```tsx
<WeeklySummaryCards summary={pageData.summary} workBalance={pageData.workBalance} />
```

- [ ] **Step 5: Render fourth card**

In `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`, import:

```tsx
import { WorkBalanceCard } from "@/components/work-balance/work-balance-card";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
```

Change props:

```ts
interface Props {
	summary: TimeSummary;
	workBalance: EmployeeWorkBalancePayload | null;
}
```

Change component signature:

```tsx
export function WeeklySummaryCards({ summary, workBalance }: Props) {
```

Change grid columns:

```tsx
<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-4">
```

Add the fourth card after the month card:

```tsx
<WorkBalanceCard balance={workBalance} />
```

- [ ] **Step 6: Run time-tracking tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit time-tracking UI**

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx
git commit -m "feat: show work balance on time tracking"
```

## Task 8: Final Verification

**Files:**
- Review changed files from Tasks 1-7.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/lib/calendar/absence-adjusted-requirements.test.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts apps/webapp/src/db/schema/__tests__/employee-work-balance-schema.test.ts apps/webapp/src/lib/work-balance/service.test.ts apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader calendar/time-tracking tests**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/lib/calendar/work-hours-summary.test.ts apps/webapp/src/lib/calendar/month-work-summary.test.ts apps/webapp/src/components/calendar/month-work-summary-view.test.tsx apps/webapp/src/components/calendar/daily-requirement-strip.test.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: PASS, or only documented pre-existing errors outside changed files.

- [ ] **Step 4: Run production build if environment allows**

Run: `CI=true pnpm build`

Expected: PASS. If the build requires unavailable Phase CLI secrets, record the skipped build and the missing environment reason in the handoff.

- [ ] **Step 5: Inspect final diff**

Run: `git status --short` and `git diff --stat HEAD`

Expected: Only intended work-balance, calendar, time-tracking, schema, migration, and test files are modified since the plan's task commits.

- [ ] **Step 6: Final commit if verification changed files**

If verification fixes were needed, commit them:

```bash
git add <fixed-files>
git commit -m "fix: stabilize work balance verification"
```

Expected: No commit is created if no fixes were needed.

## Self-Review Notes

- Spec coverage: approved absence reductions are covered in Tasks 1-2; materialized all-time table and dirty metadata are covered in Task 3; bounded 3-hour worker refresh is covered in Task 4; incremental dirty marking is covered in Task 5; calendar/time-tracking reads and UI are covered in Tasks 6-7; verification is covered in Task 8.
- Placeholder scan: the plan uses explicit file paths, commands, and code snippets for each implementation step. It avoids undefined follow-up work.
- Type consistency: all-time balance uses `employeeWorkBalance`, `EmployeeWorkBalancePayload`, `actualMinutes`, `requiredMinutes`, `balanceMinutes`, `computedFromDate`, `computedThroughDate`, `computedAt`, `isDirty`, `dirtyFromDate`, and `refreshRequestedAt` consistently across schema, service, worker, API, and UI.
