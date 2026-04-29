# Contract & Work Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build employee contract/work-model history with strict valid-from timelines, future scheduled changes, work-policy assignment sync, and employee-detail UI.

**Architecture:** Add `employee_employment_history` as the org-scoped source of truth for contract/work-model state. Keep timeline calculations in a small domain module, expose server actions from the existing employee settings area, and sync confirmed rows to employee-level `work_policy_assignment` records in the same transaction. Existing employee fields remain denormalized compatibility fields for current display and rollout safety.

**Tech Stack:** Next.js server actions, Drizzle ORM, PostgreSQL enums/tables, Effect services, TanStack Query, TanStack Form, Vitest, React Testing Library, Luxon for date logic.

---

## File Structure

- Create `apps/webapp/src/db/schema/employment-history.ts`: owns employment-history table definition and inferred DB types.
- Modify `apps/webapp/src/db/schema/enums.ts`: add `employment_status`, `work_model`, and `employment_review_state` enums.
- Modify `apps/webapp/src/db/schema/index.ts`: export the new schema module.
- Modify `apps/webapp/src/db/schema/relations.ts`: add employee, organization, work policy, and user relations for employment history.
- Modify `apps/webapp/src/db/schema/work-policy.ts`: replace the single active employee assignment unique index with indexes that allow multiple effective employee assignments.
- Create `apps/webapp/src/lib/employment-history/timeline.ts`: pure timeline helpers for non-overlap adjustment and effective-row selection.
- Create `apps/webapp/src/lib/employment-history/timeline.test.ts`: fast unit coverage for timeline rules.
- Create `apps/webapp/src/lib/validations/employment-history.ts`: Zod schemas and UI/action input types.
- Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts`: server actions for list, create, confirm, and cancel.
- Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts`: action-level tests with mocked DB service where existing action tests use this pattern.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`: resolve employee-level work policy assignments by effective dates and latest `effectiveFrom`.
- Modify `apps/webapp/src/lib/query/keys.ts`: add employment-history query keys under employees.
- Modify `apps/webapp/src/lib/query/use-employee.ts`: fetch employment history and expose mutations.
- Create `apps/webapp/src/components/settings/employee-employment-history-card.tsx`: read/write card for org admins and read-only display for others.
- Create `apps/webapp/src/components/settings/employee-employment-history-card.test.tsx`: UI behavior tests.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`: render the new card and pass access tier.
- Modify `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts`: flag missing confirmed employment history for the selected period.
- Modify `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`: coverage for missing employment history warning.

## Task 1: Schema And Relations

**Files:**
- Modify: `apps/webapp/src/db/schema/enums.ts`
- Create: `apps/webapp/src/db/schema/employment-history.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/schema/work-policy.ts`

- [ ] **Step 1: Add employment enums**

Modify `apps/webapp/src/db/schema/enums.ts` near the existing `contractTypeEnum`:

```ts
export const contractTypeEnum = pgEnum("contract_type", ["fixed", "hourly"]);
export const employmentStatusEnum = pgEnum("employment_status", [
	"active",
	"inactive",
	"terminated",
	"leave",
]);
export const workModelEnum = pgEnum("work_model", ["onsite", "hybrid", "remote", "flexible"]);
export const employmentReviewStateEnum = pgEnum("employment_review_state", [
	"draft",
	"pending",
	"confirmed",
]);
```

- [ ] **Step 2: Add the employment-history schema file**

Create `apps/webapp/src/db/schema/employment-history.ts`:

```ts
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { contractTypeEnum, employmentReviewStateEnum, employmentStatusEnum, workModelEnum } from "./enums";
import { employee } from "./organization";
import { workPolicy } from "./work-policy";

export const employeeEmploymentHistory = pgTable(
	"employee_employment_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		validFrom: timestamp("valid_from").notNull(),
		validUntil: timestamp("valid_until"),
		status: employmentStatusEnum("status").default("active").notNull(),
		contractType: contractTypeEnum("contract_type").default("fixed").notNull(),
		weeklyContractMinutes: integer("weekly_contract_minutes").notNull(),
		probationStartsOn: timestamp("probation_starts_on", { mode: "date" }),
		probationEndsOn: timestamp("probation_ends_on", { mode: "date" }),
		workModel: workModelEnum("work_model").default("onsite").notNull(),
		workPolicyId: uuid("work_policy_id").references(() => workPolicy.id, { onDelete: "set null" }),
		hourlyRate: text("hourly_rate"),
		currency: text("currency").default("EUR").notNull(),
		changeReason: text("change_reason"),
		reviewState: employmentReviewStateEnum("review_state").default("draft").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employeeEmploymentHistory_employeeId_idx").on(table.employeeId),
		index("employeeEmploymentHistory_organizationId_idx").on(table.organizationId),
		index("employeeEmploymentHistory_employee_validFrom_idx").on(table.employeeId, table.validFrom),
		index("employeeEmploymentHistory_employee_reviewState_idx").on(table.employeeId, table.reviewState),
		index("employeeEmploymentHistory_workPolicyId_idx").on(table.workPolicyId),
	],
);

export type EmployeeEmploymentHistory = typeof employeeEmploymentHistory.$inferSelect;
export type NewEmployeeEmploymentHistory = typeof employeeEmploymentHistory.$inferInsert;
```

- [ ] **Step 3: Export the new schema module**

Modify `apps/webapp/src/db/schema/index.ts` near the organization export:

```ts
export * from "./organization";
export * from "./employment-history";
```

- [ ] **Step 4: Add relations imports and relation entries**

Modify `apps/webapp/src/db/schema/relations.ts` imports to include `employeeEmploymentHistory`, then add to `employeeRelations`:

```ts
employmentHistory: many(employeeEmploymentHistory),
```

Add relation definition near the existing employee-related relation blocks:

```ts
export const employeeEmploymentHistoryRelations = relations(
	employeeEmploymentHistory,
	({ one }) => ({
		employee: one(employee, {
			fields: [employeeEmploymentHistory.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [employeeEmploymentHistory.organizationId],
			references: [organization.id],
		}),
		workPolicy: one(workPolicy, {
			fields: [employeeEmploymentHistory.workPolicyId],
			references: [workPolicy.id],
		}),
		creator: one(user, {
			fields: [employeeEmploymentHistory.createdBy],
			references: [user.id],
		}),
		updater: one(user, {
			fields: [employeeEmploymentHistory.updatedBy],
			references: [user.id],
		}),
	}),
);
```

- [ ] **Step 5: Relax employee assignment uniqueness**

Modify `apps/webapp/src/db/schema/work-policy.ts` table indexes by replacing the employee unique index with lookup indexes:

```ts
index("workPolicyAssignment_employee_effective_idx").on(
	table.employeeId,
	table.effectiveFrom,
	table.effectiveUntil,
),
index("workPolicyAssignment_employee_active_idx").on(table.employeeId, table.isActive),
```

Keep the existing organization default and team unique indexes unchanged.

- [ ] **Step 6: Run schema typecheck by building TypeScript tests target**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/lib/time-record/__tests__/overtime.test.ts`

Expected: test runner starts successfully. If it fails because the Drizzle schema does not typecheck, fix the reported import or relation errors before continuing.

- [ ] **Step 7: Commit schema changes**

```bash
git add apps/webapp/src/db/schema/enums.ts apps/webapp/src/db/schema/employment-history.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/work-policy.ts
git commit -m "feat: add employment history schema"
```

## Task 2: Timeline Domain Helpers

**Files:**
- Create: `apps/webapp/src/lib/employment-history/timeline.test.ts`
- Create: `apps/webapp/src/lib/employment-history/timeline.ts`

- [ ] **Step 1: Write failing timeline tests**

Create `apps/webapp/src/lib/employment-history/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adjustConfirmedTimeline, findEffectiveEmploymentHistory } from "./timeline";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("employment timeline", () => {
	it("closes the previous confirmed row at the new validFrom", () => {
		const adjusted = adjustConfirmedTimeline({
			existing: [
				{ id: "old", validFrom: d("2026-01-01"), validUntil: null, reviewState: "confirmed" },
			],
			next: { id: "new", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
		});

		expect(adjusted.updates).toEqual([{ id: "old", validUntil: d("2026-04-01") }]);
		expect(adjusted.next.validUntil).toBeNull();
	});

	it("bounds a new row before the next future confirmed row", () => {
		const adjusted = adjustConfirmedTimeline({
			existing: [
				{ id: "future", validFrom: d("2026-07-01"), validUntil: null, reviewState: "confirmed" },
			],
			next: { id: "new", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
		});

		expect(adjusted.updates).toEqual([]);
		expect(adjusted.next.validUntil).toEqual(d("2026-07-01"));
	});

	it("ignores draft and pending rows for effective lookup", () => {
		const row = findEffectiveEmploymentHistory([
			{ id: "draft", validFrom: d("2026-01-01"), validUntil: null, reviewState: "draft" },
			{ id: "pending", validFrom: d("2026-01-01"), validUntil: null, reviewState: "pending" },
			{ id: "confirmed", validFrom: d("2026-02-01"), validUntil: null, reviewState: "confirmed" },
		], d("2026-03-01"));

		expect(row?.id).toBe("confirmed");
	});

	it("does not return a future confirmed row before it starts", () => {
		const row = findEffectiveEmploymentHistory([
			{ id: "future", validFrom: d("2026-07-01"), validUntil: null, reviewState: "confirmed" },
		], d("2026-06-30"));

		expect(row).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/lib/employment-history/timeline.test.ts`

Expected: FAIL because `./timeline` does not exist.

- [ ] **Step 3: Implement timeline helpers**

Create `apps/webapp/src/lib/employment-history/timeline.ts`:

```ts
type ReviewState = "draft" | "pending" | "confirmed";

export type EmploymentTimelineRow = {
	id: string;
	validFrom: Date;
	validUntil: Date | null;
	reviewState: ReviewState;
};

export type TimelineUpdate = {
	id: string;
	validUntil: Date | null;
};

export function findEffectiveEmploymentHistory<T extends EmploymentTimelineRow>(
	rows: T[],
	at: Date,
): T | null {
	return rows
		.filter((row) => row.reviewState === "confirmed")
		.filter((row) => row.validFrom.getTime() <= at.getTime())
		.filter((row) => !row.validUntil || row.validUntil.getTime() > at.getTime())
		.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null;
}

export function adjustConfirmedTimeline<T extends EmploymentTimelineRow>({
	existing,
	next,
}: {
	existing: T[];
	next: T;
}): { next: T; updates: TimelineUpdate[] } {
	if (next.reviewState !== "confirmed") {
		return { next, updates: [] };
	}

	const confirmed = existing
		.filter((row) => row.reviewState === "confirmed" && row.id !== next.id)
		.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
	const previous = confirmed
		.filter((row) => row.validFrom.getTime() < next.validFrom.getTime())
		.at(-1);
	const following = confirmed.find((row) => row.validFrom.getTime() > next.validFrom.getTime());
	const updates: TimelineUpdate[] = [];

	if (previous && (!previous.validUntil || previous.validUntil.getTime() !== next.validFrom.getTime())) {
		updates.push({ id: previous.id, validUntil: next.validFrom });
	}

	return {
		next: {
			...next,
			validUntil: following ? following.validFrom : next.validUntil,
		},
		updates,
	};
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/lib/employment-history/timeline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit timeline helpers**

```bash
git add apps/webapp/src/lib/employment-history/timeline.ts apps/webapp/src/lib/employment-history/timeline.test.ts
git commit -m "feat: add employment timeline helpers"
```

## Task 3: Validation Schemas

**Files:**
- Create: `apps/webapp/src/lib/validations/employment-history.ts`
- Test through: `apps/webapp/src/lib/employment-history/timeline.test.ts`

- [ ] **Step 1: Add validation schema**

Create `apps/webapp/src/lib/validations/employment-history.ts`:

```ts
import * as z from "zod";
import { contractTypeSchema, hourlyRateSchema } from "./employee";

export const employmentStatusSchema = z.enum(["active", "inactive", "terminated", "leave"]);
export const workModelSchema = z.enum(["onsite", "hybrid", "remote", "flexible"]);
export const employmentReviewStateSchema = z.enum(["draft", "pending", "confirmed"]);

export const upsertEmploymentHistorySchema = z
	.object({
		validFrom: z.date(),
		status: employmentStatusSchema.default("active"),
		contractType: contractTypeSchema.default("fixed"),
		weeklyContractMinutes: z.number().int().min(0).max(10080),
		probationStartsOn: z.date().optional().nullable(),
		probationEndsOn: z.date().optional().nullable(),
		workModel: workModelSchema.default("onsite"),
		workPolicyId: z.string().uuid("Invalid work policy ID").optional().nullable(),
		hourlyRate: hourlyRateSchema,
		currency: z.string().min(3).max(3).default("EUR"),
		changeReason: z.string().max(1000, "Reason is too long").optional().nullable(),
		reviewState: employmentReviewStateSchema.default("draft"),
	})
	.refine(
		(data) => {
			if (!data.probationStartsOn || !data.probationEndsOn) return true;
			return data.probationEndsOn > data.probationStartsOn;
		},
		{ message: "Probation end must be after probation start", path: ["probationEndsOn"] },
	)
	.refine(
		(data) => data.contractType !== "hourly" || !!data.hourlyRate,
		{ message: "Hourly rate is required for hourly contracts", path: ["hourlyRate"] },
	);

export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;
export type WorkModel = z.infer<typeof workModelSchema>;
export type EmploymentReviewState = z.infer<typeof employmentReviewStateSchema>;
export type UpsertEmploymentHistory = z.infer<typeof upsertEmploymentHistorySchema>;
```

- [ ] **Step 2: Run validation typecheck through tests**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/lib/employment-history/timeline.test.ts`

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Commit validation schema**

```bash
git add apps/webapp/src/lib/validations/employment-history.ts
git commit -m "feat: add employment history validation"
```

## Task 4: Server Actions And Work-Policy Sync

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts`

- [ ] **Step 1: Write action behavior tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts` with focused unit tests around pure exported helpers from the action file:

```ts
import { describe, expect, it } from "vitest";
import { buildEmploymentAssignmentSyncPlan, shouldUpdateCurrentEmployeeFields } from "./employment-history-actions";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("employment history action helpers", () => {
	it("updates current employee fields for current confirmed rows", () => {
		expect(
			shouldUpdateCurrentEmployeeFields({ validFrom: d("2026-01-01"), validUntil: null, reviewState: "confirmed" }, d("2026-04-01")),
		).toBe(true);
	});

	it("does not update current employee fields for future confirmed rows", () => {
		expect(
			shouldUpdateCurrentEmployeeFields({ validFrom: d("2026-07-01"), validUntil: null, reviewState: "confirmed" }, d("2026-04-01")),
		).toBe(false);
	});

	it("does not sync assignments for draft rows", () => {
		expect(
			buildEmploymentAssignmentSyncPlan({
				employeeId: "employee-1",
				organizationId: "org-1",
				workPolicyId: "policy-1",
				validFrom: d("2026-01-01"),
				validUntil: null,
				reviewState: "draft",
			}),
		).toBeNull();
	});

	it("builds employee assignment values for confirmed rows with a policy", () => {
		expect(
			buildEmploymentAssignmentSyncPlan({
				employeeId: "employee-1",
				organizationId: "org-1",
				workPolicyId: "policy-1",
				validFrom: d("2026-01-01"),
				validUntil: d("2026-04-01"),
				reviewState: "confirmed",
			}),
		).toMatchObject({
			policyId: "policy-1",
			organizationId: "org-1",
			assignmentType: "employee",
			employeeId: "employee-1",
			priority: 2,
			isActive: true,
		});
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts'`

Expected: FAIL because `employment-history-actions.ts` does not exist.

- [ ] **Step 3: Implement server action helpers and actions**

Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts`:

```ts
"use server";

import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	employee,
	employeeEmploymentHistory,
	workPolicy,
	workPolicyAssignment,
} from "@/db/schema";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { adjustConfirmedTimeline } from "@/lib/employment-history/timeline";
import {
	type UpsertEmploymentHistory,
	upsertEmploymentHistorySchema,
} from "@/lib/validations/employment-history";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
	validateInput,
} from "./employee-action-utils";

type SyncableEmploymentRow = {
	employeeId: string;
	organizationId: string;
	workPolicyId: string | null;
	validFrom: Date;
	validUntil: Date | null;
	reviewState: "draft" | "pending" | "confirmed";
};

export function shouldUpdateCurrentEmployeeFields(
	row: Pick<SyncableEmploymentRow, "validFrom" | "validUntil" | "reviewState">,
	now = new Date(),
) {
	return (
		row.reviewState === "confirmed" &&
		row.validFrom.getTime() <= now.getTime() &&
		(!row.validUntil || row.validUntil.getTime() > now.getTime())
	);
}

export function buildEmploymentAssignmentSyncPlan(row: SyncableEmploymentRow) {
	if (row.reviewState !== "confirmed" || !row.workPolicyId) return null;

	return {
		policyId: row.workPolicyId,
		organizationId: row.organizationId,
		assignmentType: "employee" as const,
		employeeId: row.employeeId,
		teamId: null,
		priority: 2,
		effectiveFrom: row.validFrom,
		effectiveUntil: row.validUntil,
		isActive: true,
	};
}

export async function listEmployeeEmploymentHistoryAction(
	employeeId: string,
): Promise<ServerActionResult<(typeof employeeEmploymentHistory.$inferSelect)[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const dbService = yield* _(DatabaseService);
		const targetEmployee = yield* _(loadEmployeeOrFail(dbService, employeeId));
		yield* _(ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
			message: "You do not have access to this employee",
			resource: "employee_employment_history",
			action: "read",
		}));

		return yield* _(dbService.query("listEmployeeEmploymentHistory", async () => {
			return await dbService.db.query.employeeEmploymentHistory.findMany({
				where: and(
					eq(employeeEmploymentHistory.employeeId, employeeId),
					eq(employeeEmploymentHistory.organizationId, actor.organizationId),
				),
				with: { workPolicy: { columns: { id: true, name: true } } },
				orderBy: [asc(employeeEmploymentHistory.validFrom)],
			});
		}));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function createEmployeeEmploymentHistoryAction(
	employeeId: string,
	data: UpsertEmploymentHistory,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only organization admins can change employment history",
			resource: "employee_employment_history",
			action: "create",
		}));
		const dbService = yield* _(DatabaseService);
		const validated = yield* _(validateInput(upsertEmploymentHistorySchema, data));
		const targetEmployee = yield* _(loadEmployeeOrFail(dbService, employeeId));
		yield* _(ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
			message: "You do not have access to this employee",
			resource: "employee_employment_history",
			action: "create",
		}));

		if (validated.workPolicyId) {
			yield* _(loadWorkPolicyForOrgOrFail(dbService, validated.workPolicyId, actor.organizationId));
		}

		const inserted = yield* _(dbService.query("createEmployeeEmploymentHistory", async () => {
			return await dbService.db.transaction(async (tx) => {
				const existing = await tx.query.employeeEmploymentHistory.findMany({
					where: and(
						eq(employeeEmploymentHistory.employeeId, employeeId),
						eq(employeeEmploymentHistory.organizationId, actor.organizationId),
					),
				});
				const pending = {
					id: "new",
					validFrom: validated.validFrom,
					validUntil: null,
					reviewState: validated.reviewState,
				};
				const adjusted = adjustConfirmedTimeline({ existing, next: pending });

				for (const update of adjusted.updates) {
					await tx.update(employeeEmploymentHistory).set({ validUntil: update.validUntil, updatedBy: actor.session.user.id, updatedAt: currentTimestamp() }).where(eq(employeeEmploymentHistory.id, update.id));
				}

				const [row] = await tx.insert(employeeEmploymentHistory).values({
					employeeId,
					organizationId: actor.organizationId,
					validFrom: validated.validFrom,
					validUntil: adjusted.next.validUntil,
					status: validated.status,
					contractType: validated.contractType,
					weeklyContractMinutes: validated.weeklyContractMinutes,
					probationStartsOn: validated.probationStartsOn ?? null,
					probationEndsOn: validated.probationEndsOn ?? null,
					workModel: validated.workModel,
					workPolicyId: validated.workPolicyId ?? null,
					hourlyRate: validated.hourlyRate ?? null,
					currency: validated.currency,
					changeReason: validated.changeReason ?? null,
					reviewState: validated.reviewState,
					createdBy: actor.session.user.id,
					updatedBy: actor.session.user.id,
					updatedAt: currentTimestamp(),
				}).returning();

				if (shouldUpdateCurrentEmployeeFields(row)) {
					await tx.update(employee).set({
						contractType: row.contractType,
						currentHourlyRate: row.hourlyRate,
						isActive: row.status === "active",
						updatedAt: currentTimestamp(),
					}).where(eq(employee.id, employeeId));
				}

				const assignment = buildEmploymentAssignmentSyncPlan(row);
				if (assignment) {
					await tx.insert(workPolicyAssignment).values({
						...assignment,
						createdBy: actor.session.user.id,
						updatedAt: currentTimestamp(),
					});
				}

				return row;
			});
		}));

		return { id: inserted.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

function loadEmployeeOrFail(dbService: DatabaseService, employeeId: string) {
	return dbService.query("loadEmploymentTargetEmployee", async () => {
		const value = await dbService.db.query.employee.findFirst({ where: eq(employee.id, employeeId) });
		if (!value) throw new NotFoundError({ message: "Employee not found", entityType: "employee", entityId: employeeId });
		return value;
	});
}

function loadWorkPolicyForOrgOrFail(dbService: DatabaseService, workPolicyId: string, organizationId: string) {
	return dbService.query("loadEmploymentWorkPolicy", async () => {
		const value = await dbService.db.query.workPolicy.findFirst({ where: eq(workPolicy.id, workPolicyId) });
		if (!value) throw new NotFoundError({ message: "Work policy not found", entityType: "work_policy", entityId: workPolicyId });
		if (value.organizationId !== organizationId) throw new AuthorizationError({ message: "Work policy is not in this organization", resource: "work_policy", action: "read" });
		return value;
	});
}
```

- [ ] **Step 4: Run action helper tests**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit server action foundation**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts'
git commit -m "feat: add employment history actions"
```

## Task 5: Schedule Resolution By Effective Assignment

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

- [ ] **Step 1: Add a focused test case for latest effective employee assignment**

Append a test to `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts` near existing effective schedule tests:

```ts
it("chooses the latest currently effective employee assignment before future assignments", async () => {
	const now = new Date("2026-04-15T12:00:00.000Z");
	vi.setSystemTime(now);
	mockDb.query.employee.findFirst.mockResolvedValue({ id: "employee-1", organizationId: "org-1", teamId: null });
	mockDb.query.workPolicyAssignment.findFirst
		.mockResolvedValueOnce({
			policy: { isActive: true, scheduleEnabled: true, name: "Current", schedule: { scheduleCycle: "weekly", scheduleType: "simple", hoursPerCycle: "40", homeOfficeDaysPerCycle: 0, days: [] } },
		})
		.mockResolvedValueOnce(null);

	const result = await getEmployeeEffectiveScheduleDetails("employee-1");

	expect(result.success).toBe(true);
	expect(result.data?.policyName).toBe("Current");
	expect(mockDb.query.workPolicyAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
		orderBy: expect.any(Array),
	}));
});
```

- [ ] **Step 2: Run test to verify failure or missing order expectation**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts'`

Expected: FAIL until schedule resolution orders by latest `effectiveFrom`.

- [ ] **Step 3: Update employee, team, and org assignment lookups**

In `getEmployeeEffectiveScheduleDetails`, add `orderBy` to all three `workPolicyAssignment.findFirst` calls:

```ts
orderBy: (assignment, { desc }) => [desc(assignment.effectiveFrom), desc(assignment.createdAt)],
```

Keep the existing date predicates:

```ts
or(isNull(workPolicyAssignment.effectiveFrom), lte(workPolicyAssignment.effectiveFrom, now)),
or(isNull(workPolicyAssignment.effectiveUntil), gte(workPolicyAssignment.effectiveUntil, now)),
```

- [ ] **Step 4: Run work-policy tests**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit schedule resolution update**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts'
git commit -m "fix: resolve work policies by effective date"
```

## Task 5A: Confirm And Cancel Employment Changes

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts`

- [ ] **Step 1: Add confirm and cancel helper tests**

Append to `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts`:

```ts
import { canCancelEmploymentHistoryRow, shouldConfirmEmploymentHistoryRow } from "./employment-history-actions";

it("allows confirming draft and pending rows", () => {
	expect(shouldConfirmEmploymentHistoryRow({ reviewState: "draft" })).toBe(true);
	expect(shouldConfirmEmploymentHistoryRow({ reviewState: "pending" })).toBe(true);
	expect(shouldConfirmEmploymentHistoryRow({ reviewState: "confirmed" })).toBe(false);
});

it("allows canceling rows that have not taken effect", () => {
	const now = d("2026-04-01");
	expect(canCancelEmploymentHistoryRow({ reviewState: "draft", validFrom: d("2026-01-01") }, now)).toBe(true);
	expect(canCancelEmploymentHistoryRow({ reviewState: "pending", validFrom: d("2026-01-01") }, now)).toBe(true);
	expect(canCancelEmploymentHistoryRow({ reviewState: "confirmed", validFrom: d("2026-05-01") }, now)).toBe(true);
	expect(canCancelEmploymentHistoryRow({ reviewState: "confirmed", validFrom: d("2026-03-01") }, now)).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts'`

Expected: FAIL because the confirm/cancel helpers do not exist.

- [ ] **Step 3: Add confirm/cancel helpers and actions**

Add to `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts` after `buildEmploymentAssignmentSyncPlan`:

```ts
export function shouldConfirmEmploymentHistoryRow(row: { reviewState: "draft" | "pending" | "confirmed" }) {
	return row.reviewState === "draft" || row.reviewState === "pending";
}

export function canCancelEmploymentHistoryRow(
	row: { reviewState: "draft" | "pending" | "confirmed"; validFrom: Date },
	now = new Date(),
) {
	if (row.reviewState === "draft" || row.reviewState === "pending") return true;
	return row.reviewState === "confirmed" && row.validFrom.getTime() > now.getTime();
}
```

Add confirm action:

```ts
export async function confirmEmployeeEmploymentHistoryAction(
	employeeId: string,
	historyId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only organization admins can confirm employment history",
			resource: "employee_employment_history",
			action: "update",
		}));
		const dbService = yield* _(DatabaseService);
		const targetEmployee = yield* _(loadEmployeeOrFail(dbService, employeeId));
		yield* _(ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
			message: "You do not have access to this employee",
			resource: "employee_employment_history",
			action: "update",
		}));

		yield* _(dbService.query("confirmEmployeeEmploymentHistory", async () => {
			await dbService.db.transaction(async (tx) => {
				const row = await tx.query.employeeEmploymentHistory.findFirst({
					where: and(
						eq(employeeEmploymentHistory.id, historyId),
						eq(employeeEmploymentHistory.employeeId, employeeId),
						eq(employeeEmploymentHistory.organizationId, actor.organizationId),
					),
				});
				if (!row) throw new NotFoundError({ message: "Employment history not found", entityType: "employee_employment_history", entityId: historyId });
				if (!shouldConfirmEmploymentHistoryRow(row)) throw new ValidationError({ message: "Only draft or pending employment changes can be confirmed", field: "reviewState", value: row.reviewState });

				const existing = await tx.query.employeeEmploymentHistory.findMany({
					where: and(
						eq(employeeEmploymentHistory.employeeId, employeeId),
						eq(employeeEmploymentHistory.organizationId, actor.organizationId),
					),
				});
				const adjusted = adjustConfirmedTimeline({ existing, next: { ...row, reviewState: "confirmed" as const } });

				for (const update of adjusted.updates) {
					await tx.update(employeeEmploymentHistory).set({ validUntil: update.validUntil, updatedBy: actor.session.user.id, updatedAt: currentTimestamp() }).where(eq(employeeEmploymentHistory.id, update.id));
				}

				const [confirmed] = await tx.update(employeeEmploymentHistory).set({ reviewState: "confirmed", validUntil: adjusted.next.validUntil, updatedBy: actor.session.user.id, updatedAt: currentTimestamp() }).where(eq(employeeEmploymentHistory.id, historyId)).returning();
				if (shouldUpdateCurrentEmployeeFields(confirmed)) {
					await tx.update(employee).set({ contractType: confirmed.contractType, currentHourlyRate: confirmed.hourlyRate, isActive: confirmed.status === "active", updatedAt: currentTimestamp() }).where(eq(employee.id, employeeId));
				}
				const assignment = buildEmploymentAssignmentSyncPlan(confirmed);
				if (assignment) await tx.insert(workPolicyAssignment).values({ ...assignment, createdBy: actor.session.user.id, updatedAt: currentTimestamp() });
			});
		}));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

Add cancel action:

```ts
export async function cancelEmployeeEmploymentHistoryAction(
	employeeId: string,
	historyId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only organization admins can cancel employment history",
			resource: "employee_employment_history",
			action: "delete",
		}));
		const dbService = yield* _(DatabaseService);
		const row = yield* _(dbService.query("loadCancelableEmploymentHistory", async () => {
			return await dbService.db.query.employeeEmploymentHistory.findFirst({
				where: and(
					eq(employeeEmploymentHistory.id, historyId),
					eq(employeeEmploymentHistory.employeeId, employeeId),
					eq(employeeEmploymentHistory.organizationId, actor.organizationId),
				),
			});
		}));
		if (!row) return yield* _(Effect.fail(new NotFoundError({ message: "Employment history not found", entityType: "employee_employment_history", entityId: historyId })));
		if (!canCancelEmploymentHistoryRow(row)) return yield* _(Effect.fail(new ValidationError({ message: "Only draft, pending, or future confirmed employment changes can be canceled", field: "validFrom", value: row.validFrom.toISOString() })));

		yield* _(dbService.query("cancelEmployeeEmploymentHistory", async () => {
			await dbService.db.delete(employeeEmploymentHistory).where(eq(employeeEmploymentHistory.id, historyId));
		}));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 4: Run confirm/cancel tests**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit confirm/cancel actions**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts'
git commit -m "feat: confirm and cancel employment changes"
```

## Task 6: Query Hook Integration

**Files:**
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Modify: `apps/webapp/src/lib/query/use-employee.ts`

- [ ] **Step 1: Add query keys**

Modify `apps/webapp/src/lib/query/keys.ts` under `employees`:

```ts
employmentHistory: (employeeId: string) =>
	["employees", "detail", employeeId, "employment-history"] as const,
```

- [ ] **Step 2: Add hook imports and query/mutation return values**

Modify `apps/webapp/src/lib/query/use-employee.ts` imports:

```ts
import {
	cancelEmployeeEmploymentHistoryAction,
	confirmEmployeeEmploymentHistoryAction,
	createEmployeeEmploymentHistoryAction,
	listEmployeeEmploymentHistoryAction,
} from "@/app/[locale]/(app)/settings/employees/employment-history-actions";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";
```

Add the query after rate history:

```ts
const employmentHistoryQuery = useQuery({
	queryKey: queryKeys.employees.employmentHistory(employeeId),
	queryFn: async () => {
		const result = await listEmployeeEmploymentHistoryAction(employeeId);
		if (!result.success) return [];
		return result.data ?? [];
	},
	enabled: enabled && hasEmployee,
	staleTime: 30 * 1000,
});
```

Add mutation:

```ts
const createEmploymentHistoryMutation = useMutation({
	mutationFn: (data: UpsertEmploymentHistory) => createEmployeeEmploymentHistoryAction(employeeId, data),
	onSuccess: (result) => {
		if (result.success) {
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.employmentHistory(employeeId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(employeeId) });
		}
	},
});

const confirmEmploymentHistoryMutation = useMutation({
	mutationFn: (historyId: string) => confirmEmployeeEmploymentHistoryAction(employeeId, historyId),
	onSuccess: (result) => {
		if (result.success) {
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.employmentHistory(employeeId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(employeeId) });
		}
	},
});

const cancelEmploymentHistoryMutation = useMutation({
	mutationFn: (historyId: string) => cancelEmployeeEmploymentHistoryAction(employeeId, historyId),
	onSuccess: (result) => {
		if (result.success) {
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.employmentHistory(employeeId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(employeeId) });
		}
	},
});
```

Return:

```ts
employmentHistory: employmentHistoryQuery.data ?? [],
isLoadingEmploymentHistory: employmentHistoryQuery.isLoading,
createEmploymentHistory: createEmploymentHistoryMutation.mutateAsync,
isCreatingEmploymentHistory: createEmploymentHistoryMutation.isPending,
confirmEmploymentHistory: confirmEmploymentHistoryMutation.mutateAsync,
isConfirmingEmploymentHistory: confirmEmploymentHistoryMutation.isPending,
cancelEmploymentHistory: cancelEmploymentHistoryMutation.mutateAsync,
isCancelingEmploymentHistory: cancelEmploymentHistoryMutation.isPending,
```

- [ ] **Step 3: Run hook typecheck through an employee page test**

Run: `pnpm --filter webapp test -- --run 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.test.ts'`

Expected: PASS with no TypeScript import errors.

- [ ] **Step 4: Commit query integration**

```bash
git add apps/webapp/src/lib/query/keys.ts apps/webapp/src/lib/query/use-employee.ts
git commit -m "feat: expose employment history queries"
```

## Task 7: Employee Detail UI Card

**Files:**
- Create: `apps/webapp/src/components/settings/employee-employment-history-card.test.tsx`
- Create: `apps/webapp/src/components/settings/employee-employment-history-card.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`

- [ ] **Step 1: Write UI tests**

Create `apps/webapp/src/components/settings/employee-employment-history-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeEmploymentHistoryCard } from "./employee-employment-history-card";

const baseRow = {
	id: "history-1",
	employeeId: "employee-1",
	organizationId: "org-1",
	validFrom: new Date("2026-01-01T00:00:00.000Z"),
	validUntil: null,
	status: "active" as const,
	contractType: "fixed" as const,
	weeklyContractMinutes: 2400,
	probationStartsOn: null,
	probationEndsOn: null,
	workModel: "hybrid" as const,
	workPolicyId: "policy-1",
	hourlyRate: null,
	currency: "EUR",
	changeReason: "Initial contract",
	reviewState: "confirmed" as const,
	createdBy: "user-1",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedBy: "user-1",
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("EmployeeEmploymentHistoryCard", () => {
	it("shows current contract context", () => {
		render(<EmployeeEmploymentHistoryCard history={[baseRow]} canManage={true} onCreate={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} isCreating={false} isMutating={false} />);

		expect(screen.getByText("Contract & Work Model")).toBeInTheDocument();
		expect(screen.getByText("40h / week")).toBeInTheDocument();
		expect(screen.getByText("hybrid")).toBeInTheDocument();
	});

	it("hides add action for read-only users", () => {
		render(<EmployeeEmploymentHistoryCard history={[baseRow]} canManage={false} onCreate={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} isCreating={false} isMutating={false} />);

		expect(screen.queryByRole("button", { name: "Add change" })).not.toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run UI tests to verify failure**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/components/settings/employee-employment-history-card.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the UI card**

Create `apps/webapp/src/components/settings/employee-employment-history-card.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EmployeeEmploymentHistory } from "@/db/schema";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";

type EmploymentHistoryRow = EmployeeEmploymentHistory;

export function EmployeeEmploymentHistoryCard({
	history,
	canManage,
	onCreate,
	onConfirm,
	onCancel,
	isCreating,
	isMutating,
}: {
	history: EmploymentHistoryRow[];
	canManage: boolean;
	onCreate: (data: UpsertEmploymentHistory) => Promise<unknown>;
	onConfirm: (historyId: string) => Promise<unknown>;
	onCancel: (historyId: string) => Promise<unknown>;
	isCreating: boolean;
	isMutating: boolean;
}) {
	const sorted = [...history].sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
	const now = new Date();
	const current = sorted.find((row) => row.reviewState === "confirmed" && row.validFrom <= now && (!row.validUntil || row.validUntil > now));
	const next = sorted.find((row) => row.reviewState === "confirmed" && row.validFrom > now);
	const form = useForm({
		defaultValues: {
			validFrom: DateTime.now().toISODate() ?? "",
			reviewState: "draft",
			contractType: "fixed",
			weeklyContractHours: "40",
			workModel: "onsite",
			changeReason: "",
		},
		onSubmit: async ({ value }) => {
			await onCreate({
				validFrom: DateTime.fromISO(value.validFrom).toJSDate(),
				reviewState: value.reviewState as UpsertEmploymentHistory["reviewState"],
				contractType: value.contractType as UpsertEmploymentHistory["contractType"],
				weeklyContractMinutes: Math.round(Number(value.weeklyContractHours) * 60),
				workModel: value.workModel as UpsertEmploymentHistory["workModel"],
				status: "active",
				changeReason: value.changeReason || null,
				workPolicyId: null,
				hourlyRate: null,
				currency: "EUR",
			});
		},
	});

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle>Contract & Work Model</CardTitle>
						<CardDescription>Track contract hours, work model, probation, and scheduled employment changes.</CardDescription>
					</div>
					{canManage ? <Button type="submit" form="employment-history-form" disabled={isCreating}><IconPlus className="mr-2 size-4" aria-hidden="true" />Add change</Button> : null}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-3 md:grid-cols-2">
					<SummaryBox label="Current" value={current ? `${current.weeklyContractMinutes / 60}h / week` : "No confirmed history"} detail={current?.workModel ?? "Fallback employee fields may apply"} />
					<SummaryBox label="Next scheduled" value={next ? DateTime.fromJSDate(next.validFrom).toFormat("dd LLL yyyy") : "None"} detail={next ? `${next.weeklyContractMinutes / 60}h / week` : "No future confirmed change"} />
				</div>

				{canManage ? (
					<form id="employment-history-form" className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); form.handleSubmit(); }}>
						<form.Field name="validFrom">{(field) => <Field label="Effective date"><Input type="date" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /></Field>}</form.Field>
						<form.Field name="weeklyContractHours">{(field) => <Field label="Weekly hours"><Input inputMode="decimal" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /></Field>}</form.Field>
						<form.Field name="reviewState">{(field) => <Field label="Review state"><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem></SelectContent></Select></Field>}</form.Field>
						<form.Field name="workModel">{(field) => <Field label="Work model"><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="onsite">On-site</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem><SelectItem value="remote">Remote</SelectItem><SelectItem value="flexible">Flexible</SelectItem></SelectContent></Select></Field>}</form.Field>
					</form>
				) : null}

				<div className="space-y-2">
					{sorted.map((row) => {
						const canConfirm = canManage && (row.reviewState === "draft" || row.reviewState === "pending");
						const canCancel = canManage && (row.reviewState === "draft" || row.reviewState === "pending" || (row.reviewState === "confirmed" && row.validFrom > now));
						return (
							<div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
								<span>{DateTime.fromJSDate(row.validFrom).toFormat("dd LLL yyyy")}</span>
								<span>{row.weeklyContractMinutes / 60}h / week</span>
								<span>{row.workModel}</span>
								<span>{row.reviewState}</span>
								{canConfirm ? <Button type="button" size="sm" variant="secondary" disabled={isMutating} onClick={() => onConfirm(row.id)}>Confirm</Button> : null}
								{canCancel ? <Button type="button" size="sm" variant="outline" disabled={isMutating} onClick={() => onCancel(row.id)}>Cancel</Button> : null}
							</div>
						);
					})}
				</div>
				{isCreating ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><IconLoader2 className="size-4 animate-spin" aria-hidden="true" />Saving change</div> : null}
			</CardContent>
		</Card>
	);
}

function SummaryBox({ label, value, detail }: { label: string; value: string; detail: string }) {
	return <div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">{label}</div><div className="font-medium">{value}</div><div className="text-sm text-muted-foreground">{detail}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}
```

- [ ] **Step 4: Render card from employee detail page**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`:

```tsx
import { EmployeeEmploymentHistoryCard } from "@/components/settings/employee-employment-history-card";
```

Destructure from `useEmployee`:

```ts
employmentHistory,
createEmploymentHistory,
isCreatingEmploymentHistory,
confirmEmploymentHistory,
isConfirmingEmploymentHistory,
cancelEmploymentHistory,
isCancelingEmploymentHistory,
```

Render after the edit form grid:

```tsx
<EmployeeEmploymentHistoryCard
	history={employmentHistory}
	canManage={accessTier === "orgAdmin"}
	onCreate={createEmploymentHistory}
	onConfirm={confirmEmploymentHistory}
	onCancel={cancelEmploymentHistory}
	isCreating={isCreatingEmploymentHistory}
	isMutating={isConfirmingEmploymentHistory || isCancelingEmploymentHistory}
/>
```

- [ ] **Step 5: Run UI tests**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/components/settings/employee-employment-history-card.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit UI card**

```bash
git add apps/webapp/src/components/settings/employee-employment-history-card.tsx apps/webapp/src/components/settings/employee-employment-history-card.test.tsx 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx'
git commit -m "feat: show employment history on employee details"
```

## Task 8: Payroll Readiness Missing Employment History Warning

**Files:**
- Modify: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`
- Modify: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts`

- [ ] **Step 1: Add failing payroll readiness test**

Modify `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts` to mock `employeeEmploymentHistory.findMany` and add:

```ts
it("warns when active employees lack confirmed employment history for the selected period", async () => {
	mockState.employeeFindMany.mockResolvedValue([{ id: "employee-1", user: { name: "Ada Lovelace", email: "ada@example.com" }, employeeNumber: "EMP-1" }]);
	mockState.employeeEmploymentHistoryFindMany.mockResolvedValue([]);

	const result = await getPayrollReadiness({ organizationId: "org-1", startDate: "2026-03-01", endDate: "2026-03-31" });

	expect(getCheck(result, "missing-employment-history")).toMatchObject({
		status: "warning",
		severity: "warning",
		count: 1,
	});
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: FAIL because the check is not implemented.

- [ ] **Step 3: Add readiness query and check**

Modify `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts` imports to include `employeeEmploymentHistory` and add a warning check that finds active employees without any confirmed row overlapping the selected range:

```ts
const employmentHistoryRows = await db.query.employeeEmploymentHistory.findMany({
	where: and(
		eq(employeeEmploymentHistory.organizationId, organizationId),
		eq(employeeEmploymentHistory.reviewState, "confirmed"),
		lte(employeeEmploymentHistory.validFrom, selectedEnd),
		or(isNull(employeeEmploymentHistory.validUntil), gt(employeeEmploymentHistory.validUntil, selectedStart)),
	),
});
const employeesWithHistory = new Set(employmentHistoryRows.map((row) => row.employeeId));
const missingEmploymentHistory = activeEmployees.filter((entry) => !employeesWithHistory.has(entry.id));
```

Add a check:

```ts
{
	id: "missing-employment-history",
	group: "payrollSetup",
	title: "Employment history coverage",
	status: missingEmploymentHistory.length > 0 ? "warning" : "pass",
	severity: "warning",
	count: missingEmploymentHistory.length,
	description: missingEmploymentHistory.length > 0
		? "Some active employees do not have confirmed contract/work-model history for this payroll period."
		: "All active employees have confirmed employment history for this payroll period.",
	actionHref: "/settings/employees",
	actionLabel: "Review employees",
	affectedEmployees: toAffectedEmployees(missingEmploymentHistory, "id", "Missing employment history", "/settings/employees"),
}
```

- [ ] **Step 4: Run payroll readiness tests**

Run: `pnpm --filter webapp test -- --run apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit payroll readiness integration**

```bash
git add apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts
git commit -m "feat: warn on missing employment history"
```

## Task 9: Final Verification

**Files:**
- Verify all changed files from Tasks 1-8.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter webapp test -- --run apps/webapp/src/lib/employment-history/timeline.test.ts 'apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts' 'apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts' apps/webapp/src/components/settings/employee-employment-history-card.test.tsx apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts
```

Expected: all listed test files PASS.

- [ ] **Step 2: Run full webapp tests**

Run: `pnpm --filter webapp test -- --run`

Expected: PASS.

- [ ] **Step 3: Run production build if environment allows**

Run: `pnpm --filter webapp build`

Expected: PASS. If build requires Phase CLI environment variables that agents do not have, stop the build attempt and report it as skipped with the missing environment requirement.

- [ ] **Step 4: Review schema migration requirement**

Do not run `pnpm drizzle-kit push` from the agent environment if it requires Phase CLI secrets. Report that database push must be run by a developer with environment access.

- [ ] **Step 5: Commit final verification notes only if files changed**

If verification required code fixes, commit them:

```bash
git add apps/webapp/src docs/superpowers/plans/2026-04-28-contract-work-model-management.md
git commit -m "fix: stabilize employment history rollout"
```

If no files changed, do not create an empty commit.
