# Custom Holiday Category Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins assign a whole custom holiday category to an organization, team, or employee so all active custom holidays in that category apply automatically.

**Architecture:** Add a first-class `holiday_category_assignment` table that mirrors the existing direct custom holiday assignment target model. Server actions manage category assignments, assigned holiday reads expand category assignments into active custom holidays, and the settings UI changes the visible custom-holiday assignment flow from individual holiday selection to category selection while preserving existing direct assignments.

**Tech Stack:** Next.js server actions, Drizzle ORM/PostgreSQL, Effect server action wrappers, TanStack Query, TanStack Form, Vitest, Luxon for date logic already used in assigned holiday expansion.

---

## File Structure

- Modify `apps/webapp/src/db/schema/holiday.ts`: add `holidayCategoryAssignment` table.
- Modify `apps/webapp/src/db/schema/relations.ts`: add relations for category assignments and wire them into organization/category/team/employee relations.
- Create `apps/webapp/drizzle/0037_holiday_category_assignment.sql`: migration for the new table, indexes, and partial unique constraints.
- Modify `apps/webapp/drizzle/meta/_journal.json`: append migration metadata with `idx: 37`, `tag: "0037_holiday_category_assignment"`, and a `when` greater than `1780185600000`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/holidays/holiday-scope.ts`: keep the shared assignment scope filter usable for category assignment rows.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts`: add category assignment types and server actions.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.behavior.test.ts`: cover category assignment listing and authorization behavior.
- Modify `apps/webapp/src/lib/calendar/assigned-holidays.ts`: query category assignments and expand active holidays in assigned categories.
- Modify `apps/webapp/src/lib/calendar/assigned-holidays.test.ts`: add pure helper coverage for deduping direct and category-expanded custom holidays.
- Modify `apps/webapp/src/lib/query/keys.ts`: add `holidayCategoryAssignments` query keys.
- Modify `apps/webapp/src/components/settings/holiday-assignment-dialog.tsx`: make the dialog assign a category instead of a holiday.
- Modify `apps/webapp/src/components/settings/assignment-manager.tsx`: fetch, display, and delete category assignments; keep direct holiday assignments visible as legacy records.
- Modify `apps/webapp/src/components/settings/holiday-management.tsx`: invalidate category assignment queries after dialog success.

## Task 1: Schema And Migration

**Files:**
- Modify: `apps/webapp/src/db/schema/holiday.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/drizzle/0037_holiday_category_assignment.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`

- [ ] **Step 1: Add the Drizzle table**

In `apps/webapp/src/db/schema/holiday.ts`, add `holidayCategoryAssignment` after `holidayAssignment` or directly before it:

```ts
export const holidayCategoryAssignment = pgTable(
	"holiday_category_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => holidayCategory.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("holidayCategoryAssignment_categoryId_idx").on(table.categoryId),
		index("holidayCategoryAssignment_organizationId_idx").on(table.organizationId),
		index("holidayCategoryAssignment_teamId_idx").on(table.teamId),
		index("holidayCategoryAssignment_employeeId_idx").on(table.employeeId),
		uniqueIndex("holidayCategoryAssignment_category_org_idx")
			.on(table.categoryId, table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		uniqueIndex("holidayCategoryAssignment_category_team_idx")
			.on(table.categoryId, table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		uniqueIndex("holidayCategoryAssignment_category_employee_idx")
			.on(table.categoryId, table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);
```

- [ ] **Step 2: Add relations**

In `apps/webapp/src/db/schema/relations.ts`, add `holidayCategoryAssignment` to the holiday imports:

```ts
import {
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayCategoryAssignment,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
} from "./holiday";
```

In `organizationRelations`, add:

```ts
holidayCategoryAssignments: many(holidayCategoryAssignment),
```

In `holidayCategoryRelations`, add:

```ts
assignments: many(holidayCategoryAssignment),
```

Add this relation block after `holidayAssignmentRelations`:

```ts
export const holidayCategoryAssignmentRelations = relations(
	holidayCategoryAssignment,
	({ one }) => ({
		category: one(holidayCategory, {
			fields: [holidayCategoryAssignment.categoryId],
			references: [holidayCategory.id],
		}),
		organization: one(organization, {
			fields: [holidayCategoryAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [holidayCategoryAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [holidayCategoryAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [holidayCategoryAssignment.createdBy],
			references: [user.id],
		}),
	}),
);
```

- [ ] **Step 3: Create the SQL migration**

Create `apps/webapp/drizzle/0037_holiday_category_assignment.sql`:

```sql
CREATE TABLE IF NOT EXISTS "holiday_category_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_category_assignment_category_id_holiday_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_categoryId_idx" ON "holiday_category_assignment" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_organizationId_idx" ON "holiday_category_assignment" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_teamId_idx" ON "holiday_category_assignment" USING btree ("team_id");
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_employeeId_idx" ON "holiday_category_assignment" USING btree ("employee_id");

CREATE UNIQUE INDEX IF NOT EXISTS "holidayCategoryAssignment_category_org_idx"
	ON "holiday_category_assignment" USING btree ("category_id", "organization_id", "assignment_type")
	WHERE assignment_type = 'organization' AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS "holidayCategoryAssignment_category_team_idx"
	ON "holiday_category_assignment" USING btree ("category_id", "team_id")
	WHERE team_id IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS "holidayCategoryAssignment_category_employee_idx"
	ON "holiday_category_assignment" USING btree ("category_id", "employee_id")
	WHERE employee_id IS NOT NULL AND is_active = true;
```

- [ ] **Step 4: Append migration metadata**

In `apps/webapp/drizzle/meta/_journal.json`, append this object after the `0036_time_entry_timezone_capture` entry:

```json
{
  "idx": 37,
  "version": "7",
  "when": 1780185600001,
  "tag": "0037_holiday_category_assignment",
  "breakpoints": true
}
```

- [ ] **Step 5: Run typecheck for schema imports**

Run: `pnpm -C apps/webapp exec tsc --noEmit`

Expected: either PASS, or only pre-existing unrelated errors. Fix any errors caused by `holidayCategoryAssignment` imports or table definitions before continuing.

- [ ] **Step 6: Commit schema work**

```bash
git add "apps/webapp/src/db/schema/holiday.ts" "apps/webapp/src/db/schema/relations.ts" "apps/webapp/drizzle/0037_holiday_category_assignment.sql" "apps/webapp/drizzle/meta/_journal.json"
git commit -m "feat: add holiday category assignments schema"
```

## Task 2: Server Actions For Category Assignments

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.behavior.test.ts`

- [ ] **Step 1: Write failing list-action test**

In `actions.behavior.test.ts`, extend the hoisted `mockState` with category assignments:

```ts
holidayCategoryAssignments: [
	{
		id: "category-assignment-org",
		categoryId: "category-org",
		organizationId: "org-1",
		assignmentType: "organization",
		teamId: null,
		employeeId: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		category: { id: "category-org", name: "Company Closing Days", color: "#f59e0b", type: "public_holiday" },
		team: null,
		employee: null,
	},
	{
		id: "category-assignment-other-team",
		categoryId: "category-other-team",
		organizationId: "org-1",
		assignmentType: "team",
		teamId: "team-other",
		employeeId: null,
		isActive: true,
		createdAt: new Date("2026-01-04T00:00:00.000Z"),
		category: { id: "category-other-team", name: "Other Team Days", color: null, type: "public_holiday" },
		team: { id: "team-other", name: "Other Team" },
		employee: null,
	},
],
```

Add `holidayCategoryAssignment` to the `@/db/schema` mock:

```ts
holidayCategoryAssignment: {
	id: "id",
	categoryId: "categoryId",
	organizationId: "organizationId",
	assignmentType: "assignmentType",
	teamId: "teamId",
	employeeId: "employeeId",
	isActive: "isActive",
	createdAt: "createdAt",
},
```

Add `holidayCategoryAssignment.findMany` to each mocked `db.query` object that already has `holidayAssignment.findMany`:

```ts
holidayCategoryAssignment: {
	findMany: vi.fn(async () => mockState.holidayCategoryAssignments),
},
```

Update the dynamic import:

```ts
const {
	bulkDeleteHolidays,
	deleteHoliday,
	getHolidayAssignments,
	getHolidayCategoryAssignments,
} = await import("./actions");
```

Add this test:

```ts
it("lets managers read only scoped custom holiday category assignments", async () => {
	const result = await getHolidayCategoryAssignments("org-1");

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.map((assignment) => assignment.id)).toEqual(["category-assignment-org"]);
		expect(result.data[0]?.category.name).toBe("Company Closing Days");
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/webapp test src/app/[locale]/\(app\)/settings/holidays/actions.behavior.test.ts -- --run`

Expected: FAIL because `getHolidayCategoryAssignments` is not exported.

- [ ] **Step 3: Implement list action and types**

In `actions.ts`, update imports:

```ts
import { employee, holiday, holidayAssignment, holidayCategory, holidayCategoryAssignment, team } from "@/db/schema";
```

Add this type near `HolidayAssignmentRecord`:

```ts
type HolidayCategoryAssignmentRecord = {
	id: string;
	categoryId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user?: { firstName: string | null; lastName: string | null } | null;
	} | null;
};
```

Add this action after `getHolidayAssignments`:

```ts
export async function getHolidayCategoryAssignments(
	organizationId: string,
): Promise<ServerActionResult<HolidayCategoryAssignmentRecord[]>> {
	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedHolidayAccessContext(organizationId, "getHolidayCategoryAssignments:actor"),
		);

		const assignments = yield* _(
			actor.dbService.query("getHolidayCategoryAssignments", async () => {
				return await actor.dbService.db.query.holidayCategoryAssignment.findMany({
					where: and(
						eq(holidayCategoryAssignment.organizationId, organizationId),
						eq(holidayCategoryAssignment.isActive, true),
					),
					with: {
						category: { columns: { id: true, name: true, type: true, color: true } },
						team: { columns: { id: true, name: true } },
						employee: {
							columns: { id: true },
							with: { user: { columns: { firstName: true, lastName: true } } },
						},
					},
				});
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday category assignments",
						operation: "select",
						table: "holiday_category_assignment",
						cause: error,
					}),
			),
		);

		const assignmentsWithAuthNames = assignments.map((assignment) => ({
			...assignment,
			employee: assignment.employee
				? {
						id: assignment.employee.id,
						firstName: assignment.employee.user?.firstName ?? null,
						lastName: assignment.employee.user?.lastName ?? null,
						user: assignment.employee.user,
					}
				: null,
		})) satisfies HolidayCategoryAssignmentRecord[];

		return filterAssignmentsForManagerHolidayScope(
			assignmentsWithAuthNames,
			manageableTeamIds,
			managedEmployeeIds,
		);
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}
```

- [ ] **Step 4: Run list-action test**

Run: `pnpm -C apps/webapp test src/app/[locale]/\(app\)/settings/holidays/actions.behavior.test.ts -- --run`

Expected: PASS for the new list test and existing tests.

- [ ] **Step 5: Write failing create/delete action tests**

Extend mocks with select results and insert/update tracking. Add to `mockState`:

```ts
categoryRows: [{ id: "category-org", organizationId: "org-1", isActive: true }],
teamRows: [{ id: "team-managed", organizationId: "org-1" }],
employeeRows: [{ id: "employee-managed", organizationId: "org-1" }],
insertCalls: [] as Array<any>,
```

Update `beforeEach` to reset those arrays and rows. Add tests:

```ts
it("creates category assignments for org admins", async () => {
	mockState.actor.accessTier = "orgAdmin";

	const result = await createHolidayCategoryAssignment({
		categoryId: "category-org",
		assignmentType: "organization",
	});

	expect(result.success).toBe(true);
	expect(mockState.insertCalls[0]).toMatchObject({
		categoryId: "category-org",
		organizationId: "org-1",
		assignmentType: "organization",
		teamId: null,
		employeeId: null,
		createdBy: "user-1",
	});
});

it("rejects cross-org categories when creating category assignments", async () => {
	mockState.actor.accessTier = "orgAdmin";
	mockState.categoryRows = [];

	const result = await createHolidayCategoryAssignment({
		categoryId: "category-other-org",
		assignmentType: "organization",
	});

	expect(result.success).toBe(false);
	expect(result.error).toBe("Holiday category not found");
	expect(mockState.insertCalls).toEqual([]);
});

it("soft deletes category assignments for org admins", async () => {
	mockState.actor.accessTier = "orgAdmin";

	const result = await deleteHolidayCategoryAssignment("category-assignment-org");

	expect(result.success).toBe(true);
	expect(mockState.updateCalls).toContainEqual({ isActive: false });
});
```

Update the dynamic import with `createHolidayCategoryAssignment` and `deleteHolidayCategoryAssignment`.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm -C apps/webapp test src/app/[locale]/\(app\)/settings/holidays/actions.behavior.test.ts -- --run`

Expected: FAIL because create/delete actions are not exported or mocks do not yet support inserts.

- [ ] **Step 7: Implement create/delete actions**

Add helper validation inside `actions.ts` near custom assignment actions by following the `createPresetAssignment` validation pattern. Then add:

```ts
export async function createHolidayCategoryAssignment(data: {
	categoryId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
}): Promise<ServerActionResult<typeof holidayCategoryAssignment.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "createHolidayCategoryAssignment:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can create holiday category assignments",
				resource: "holiday_category_assignment",
				action: "create",
			}),
		);

		const existingCategory = yield* _(
			actor.dbService.query("verifyHolidayCategory", async () => {
				const [category] = await actor.dbService.db
					.select({ id: holidayCategory.id })
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, data.categoryId),
							eq(holidayCategory.organizationId, actor.organizationId),
							eq(holidayCategory.isActive, true),
						),
					)
					.limit(1);
				return category;
			}),
		);

		if (!existingCategory) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Holiday category not found",
						entityType: "holiday_category",
						entityId: data.categoryId,
					}),
				),
			);
		}

		if (data.assignmentType === "team") {
			const [targetTeam] = yield* _(
				actor.dbService.query("verifyHolidayCategoryAssignmentTeam", async () => {
					return await actor.dbService.db
						.select({ id: team.id })
						.from(team)
						.where(and(eq(team.id, data.teamId ?? ""), eq(team.organizationId, actor.organizationId)))
						.limit(1);
				}),
			);
			if (!targetTeam) {
				yield* _(Effect.fail(new NotFoundError({ message: "Team not found", entityType: "team", entityId: data.teamId ?? "" })));
			}
		}

		if (data.assignmentType === "employee") {
			const [targetEmployee] = yield* _(
				actor.dbService.query("verifyHolidayCategoryAssignmentEmployee", async () => {
					return await actor.dbService.db
						.select({ id: employee.id })
						.from(employee)
						.where(and(eq(employee.id, data.employeeId ?? ""), eq(employee.organizationId, actor.organizationId)))
						.limit(1);
				}),
			);
			if (!targetEmployee) {
				yield* _(Effect.fail(new NotFoundError({ message: "Employee not found", entityType: "employee", entityId: data.employeeId ?? "" })));
			}
		}

		const newAssignment = yield* _(
			actor.dbService.query("createHolidayCategoryAssignment", async () => {
				const [assignment] = await actor.dbService.db
					.insert(holidayCategoryAssignment)
					.values({
						categoryId: data.categoryId,
						organizationId: actor.organizationId,
						assignmentType: data.assignmentType,
						teamId: data.assignmentType === "team" ? data.teamId || null : null,
						employeeId: data.assignmentType === "employee" ? data.employeeId || null : null,
						createdBy: actor.session.user.id,
					})
					.returning();
				return assignment;
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create holiday category assignment",
						operation: "insert",
						table: "holiday_category_assignment",
						cause: error,
					}),
			),
		);

		return newAssignment;
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}
```

Add delete:

```ts
export async function deleteHolidayCategoryAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteHolidayCategoryAssignment:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can delete holiday category assignments",
				resource: "holiday_category_assignment",
				action: "delete",
			}),
		);

		const deletedAssignment = yield* _(
			actor.dbService.query("deleteHolidayCategoryAssignment", async () => {
				const [assignment] = await actor.dbService.db
					.update(holidayCategoryAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(holidayCategoryAssignment.id, assignmentId),
							eq(holidayCategoryAssignment.organizationId, actor.organizationId),
						),
					)
					.returning({ id: holidayCategoryAssignment.id });
				return assignment;
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday category assignment",
						operation: "update",
						table: "holiday_category_assignment",
						cause: error,
					}),
			),
		);

		if (!deletedAssignment) {
			yield* _(Effect.fail(new NotFoundError({ message: "Holiday category assignment not found", entityType: "holiday_category_assignment", entityId: assignmentId })));
		}
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}
```

- [ ] **Step 8: Run action tests**

Run: `pnpm -C apps/webapp test src/app/[locale]/\(app\)/settings/holidays/actions.behavior.test.ts -- --run`

Expected: PASS. If the test mocks need more chained Drizzle methods, extend the mocks rather than weakening the assertions.

- [ ] **Step 9: Commit server actions**

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts" "apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.behavior.test.ts"
git commit -m "feat: add holiday category assignment actions"
```

## Task 3: Assigned Holiday Expansion

**Files:**
- Modify: `apps/webapp/src/lib/calendar/assigned-holidays.ts`
- Modify: `apps/webapp/src/lib/calendar/assigned-holidays.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

In `assigned-holidays.ts`, plan to export a helper named `mergeAssignedCustomHolidays`. First add tests to `assigned-holidays.test.ts` import list:

```ts
mergeAssignedCustomHolidays,
```

Add tests:

```ts
it("expands holidays from assigned categories", () => {
	const expanded = mergeAssignedCustomHolidays({
		directAssignments: [],
		categoryAssignments: [
			{
				holidays: [
					{
						id: "holiday-category-1",
						name: "Bridge Day",
						organizationId: "org-1",
						startDate: new Date("2026-05-15T00:00:00.000Z"),
						endDate: new Date("2026-05-15T23:59:59.999Z"),
						categoryId: "category-1",
						description: null,
						isActive: true,
						recurrenceType: "none",
						recurrenceRule: null,
						recurrenceEndDate: null,
					},
				],
			},
		],
		organizationId: "org-1",
		startDate: new Date("2026-05-01T00:00:00.000Z"),
		endDate: new Date("2026-05-31T23:59:59.999Z"),
	});

	expect(expanded).toHaveLength(1);
	expect(expanded[0]?.name).toBe("Bridge Day");
});

it("dedupes a direct custom holiday and category-expanded custom holiday", () => {
	const holiday = {
		id: "holiday-duplicate",
		name: "Duplicate Day",
		organizationId: "org-1",
		startDate: new Date("2026-06-01T00:00:00.000Z"),
		endDate: new Date("2026-06-01T23:59:59.999Z"),
		categoryId: "category-1",
		description: null,
		isActive: true,
		recurrenceType: "none",
		recurrenceRule: null,
		recurrenceEndDate: null,
	} as const;

	const expanded = mergeAssignedCustomHolidays({
		directAssignments: [{ holiday }],
		categoryAssignments: [{ holidays: [holiday] }],
		organizationId: "org-1",
		startDate: new Date("2026-06-01T00:00:00.000Z"),
		endDate: new Date("2026-06-30T23:59:59.999Z"),
	});

	expect(expanded).toHaveLength(1);
	expect(expanded[0]?.id).toBe("holiday-duplicate");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/webapp test src/lib/calendar/assigned-holidays.test.ts -- --run`

Expected: FAIL because `mergeAssignedCustomHolidays` is not exported.

- [ ] **Step 3: Implement helper and query changes**

In `assigned-holidays.ts`, import the new table:

```ts
holidayCategoryAssignment,
```

Add types:

```ts
type HolidayCategoryAssignmentWithHolidays = {
	category: { holidays: CustomAssignedHoliday[] } | null;
};

type DirectHolidayAssignmentWithHoliday = {
	holiday: CustomAssignedHoliday | null;
};
```

Replace the old `HolidayAssignmentWithHoliday` use with `DirectHolidayAssignmentWithHoliday`.

Add this helper before `getAssignedHolidaysForEmployee`:

```ts
export function mergeAssignedCustomHolidays(params: {
	directAssignments: DirectHolidayAssignmentWithHoliday[];
	categoryAssignments: HolidayCategoryAssignmentWithHolidays[];
	organizationId: string;
	startDate: Date;
	endDate: Date;
}): AssignedHolidayRange[] {
	const holidaysById = new Map<string, AssignedHolidayRange>();
	const requestedRange = { startDate: params.startDate, endDate: params.endDate };

	for (const assignment of params.directAssignments) {
		const assignedHoliday = assignment.holiday;
		if (!assignedHoliday || assignedHoliday.organizationId !== params.organizationId) continue;

		for (const expandedHoliday of expandCustomAssignedHoliday(assignedHoliday, requestedRange)) {
			holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
		}
	}

	for (const assignment of params.categoryAssignments) {
		for (const assignedHoliday of assignment.category?.holidays ?? []) {
			if (!assignedHoliday || assignedHoliday.organizationId !== params.organizationId) continue;

			for (const expandedHoliday of expandCustomAssignedHoliday(assignedHoliday, requestedRange)) {
				holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
			}
		}
	}

	return [...holidaysById.values()];
}
```

In `getAssignedHolidaysForEmployee`, add a category assignment query after `customAssignments`:

```ts
const categoryAssignments = (await db.query.holidayCategoryAssignment.findMany({
	where: and(
		eq(holidayCategoryAssignment.organizationId, params.organizationId),
		eq(holidayCategoryAssignment.isActive, true),
		or(...getAssignmentScope(holidayCategoryAssignment, params.employeeId, scopedEmployee.teamId)),
	),
	with: {
		category: {
			columns: { id: true },
			with: {
				holidays: {
					where: and(eq(holiday.organizationId, params.organizationId), eq(holiday.isActive, true)),
					columns: {
						id: true,
						name: true,
						organizationId: true,
						startDate: true,
						endDate: true,
						categoryId: true,
						description: true,
						isActive: true,
						recurrenceType: true,
						recurrenceRule: true,
						recurrenceEndDate: true,
					},
				},
			},
		},
	},
})) as unknown as HolidayCategoryAssignmentWithHolidays[];
```

Replace the direct custom assignment loop with:

```ts
const holidaysById = new Map<string, AssignedHolidayRange>();

for (const expandedHoliday of mergeAssignedCustomHolidays({
	directAssignments: customAssignments,
	categoryAssignments,
	organizationId: params.organizationId,
	startDate: params.startDate,
	endDate: params.endDate,
})) {
	holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
}
```

- [ ] **Step 4: Run assigned holiday tests**

Run: `pnpm -C apps/webapp test src/lib/calendar/assigned-holidays.test.ts -- --run`

Expected: PASS.

- [ ] **Step 5: Commit assigned holiday expansion**

```bash
git add "apps/webapp/src/lib/calendar/assigned-holidays.ts" "apps/webapp/src/lib/calendar/assigned-holidays.test.ts"
git commit -m "feat: expand assigned custom holiday categories"
```

## Task 4: Query Keys And Category Assignment Dialog

**Files:**
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Modify: `apps/webapp/src/components/settings/holiday-assignment-dialog.tsx`

- [ ] **Step 1: Add query keys**

In `keys.ts`, add after `holidayAssignments`:

```ts
// Holiday category assignments (custom holiday categories to org/team/employee)
holidayCategoryAssignments: {
	all: ["holiday-category-assignments"] as const,
	list: (orgId: string) => ["holiday-category-assignments", orgId] as const,
},
```

- [ ] **Step 2: Convert dialog imports and option type**

In `holiday-assignment-dialog.tsx`, replace imports from `actions`:

```ts
import {
	createHolidayCategoryAssignment,
	getHolidayCategories,
} from "@/app/[locale]/(app)/settings/holidays/actions";
```

Replace `HolidayOption` with:

```ts
interface HolidayCategoryOption {
	id: string;
	name: string;
	type: string;
	color: string | null;
}
```

- [ ] **Step 3: Rename form field and validation**

Change form defaults:

```ts
defaultValues: {
	categoryId: "",
	teamId: "",
	employeeId: "",
},
```

Change validation from `holidayId` to `categoryId`:

```ts
if (!value.categoryId) {
	errors.categoryId = "Please select a holiday category";
}
```

- [ ] **Step 4: Fetch categories instead of holidays**

Replace the holiday query with:

```ts
const { data: categories, isLoading: categoriesLoading } = useQuery({
	queryKey: queryKeys.holidayCategories.list(organizationId, { limit: 500 }),
	queryFn: async () => {
		const result = await getHolidayCategories(organizationId);
		if (!result.success) {
			throw new Error(result.error || "Failed to fetch holiday categories");
		}
		return result.data as HolidayCategoryOption[];
	},
	enabled: open,
});
```

Update `isLoading`:

```ts
const isLoading = categoriesLoading || teamsLoading || employeesLoading;
```

- [ ] **Step 5: Create category assignment mutation**

Replace mutation input and action:

```ts
const createMutation = useMutation({
	mutationFn: (values: { categoryId: string; teamId: string; employeeId: string }) =>
		createHolidayCategoryAssignment({
			categoryId: values.categoryId,
			assignmentType,
			teamId: assignmentType === "team" ? values.teamId : undefined,
			employeeId: assignmentType === "employee" ? values.employeeId : undefined,
		}),
	onSuccess: (result) => {
		if (result.success) {
			toast.success(
				t("settings.holidays.assignments.categoryCreated", "Holiday category assignment created"),
			);
			queryClient.invalidateQueries({
				queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
			});
			onSuccess();
			onOpenChange(false);
		} else {
			toast.error(
				result.error ||
					t(
						"settings.holidays.assignments.categoryCreateFailed",
						"Failed to create holiday category assignment",
					),
			);
		}
	},
	onError: () => {
		toast.error(
			t(
				"settings.holidays.assignments.categoryCreateFailed",
				"Failed to create holiday category assignment",
			),
		);
	},
});
```

- [ ] **Step 6: Update dialog labels and select UI**

Change titles/descriptions to category wording:

```ts
case "organization":
	return t("settings.holidays.assignments.addOrgHolidayCategory", "Add Organization-Wide Holiday Category");
case "team":
	return t("settings.holidays.assignments.addTeamHolidayCategory", "Add Team Holiday Category");
case "employee":
	return t("settings.holidays.assignments.addEmployeeHolidayCategory", "Add Employee Holiday Category");
```

Replace the holiday `<form.Field name="holidayId">` block with `<form.Field name="categoryId">` and map `categories`:

```tsx
<form.Field name="categoryId">
	{(field) => (
		<div className="space-y-2">
			<Label>{t("settings.holidays.assignments.category", "Custom Holiday Category")}</Label>
			<Select value={field.state.value} onValueChange={field.handleChange}>
				<SelectTrigger>
					<SelectValue
						placeholder={t(
							"settings.holidays.assignments.selectCategory",
							"Select a category",
						)}
					/>
				</SelectTrigger>
				<SelectContent>
					{categories?.length === 0 ? (
						<div className="p-2 text-center text-sm text-muted-foreground">
							{t(
								"settings.holidays.assignments.noCategories",
								"No custom holiday categories available. Create one first.",
							)}
						</div>
					) : (
						categories?.map((category) => (
							<SelectItem key={category.id} value={category.id}>
								<div className="flex items-center gap-2">
									{category.color ? (
										<span className="size-2 rounded-full" style={{ backgroundColor: category.color }} />
									) : null}
									<span>{category.name}</span>
								</div>
							</SelectItem>
						))
					)}
				</SelectContent>
			</Select>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.holidays.assignments.categoryDescription",
					"All active custom holidays in this category will apply to the selected scope.",
				)}
			</p>
			{validationErrors.categoryId && (
				<p className="text-sm text-destructive">{validationErrors.categoryId}</p>
			)}
		</div>
	)}
</form.Field>
```

Update submit disabled:

```tsx
<Button type="submit" disabled={createMutation.isPending || categories?.length === 0}>
```

- [ ] **Step 7: Run TypeScript for dialog**

Run: `pnpm -C apps/webapp exec tsc --noEmit`

Expected: PASS, or only unrelated pre-existing errors. Fix references to `holidays`, `holidayId`, and `holidaysLoading` in `holiday-assignment-dialog.tsx`.

- [ ] **Step 8: Commit dialog changes**

```bash
git add "apps/webapp/src/lib/query/keys.ts" "apps/webapp/src/components/settings/holiday-assignment-dialog.tsx"
git commit -m "feat: assign custom holiday categories from settings"
```

## Task 5: Assignment Manager Display And Deletion

**Files:**
- Modify: `apps/webapp/src/components/settings/assignment-manager.tsx`
- Modify: `apps/webapp/src/components/settings/holiday-management.tsx`

- [ ] **Step 1: Add category assignment imports**

In `assignment-manager.tsx`, import actions:

```ts
import {
	deleteHolidayAssignment,
	deleteHolidayCategoryAssignment,
	getHolidayAssignments,
	getHolidayCategoryAssignments,
} from "@/app/[locale]/(app)/settings/holidays/actions";
```

- [ ] **Step 2: Add data type and state**

Add type:

```ts
interface HolidayCategoryAssignmentData {
	id: string;
	categoryId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
	team: { id: string; name: string } | null;
	employee: { id: string; firstName: string | null; lastName: string | null } | null;
}
```

Add state:

```ts
const [selectedCategoryAssignment, setSelectedCategoryAssignment] =
	useState<HolidayCategoryAssignmentData | null>(null);
```

- [ ] **Step 3: Fetch category assignments**

Add query after holiday assignments query:

```ts
const {
	data: categoryAssignments,
	isLoading: categoryLoading,
	error: categoryError,
} = useQuery({
	queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
	queryFn: async () => {
		const result = await getHolidayCategoryAssignments(organizationId);
		if (!result.success) {
			throw new Error(result.error || "Failed to fetch holiday category assignments");
		}
		return result.data as HolidayCategoryAssignmentData[];
	},
});
```

Update loading/error:

```ts
const isLoading = presetLoading || holidayLoading || categoryLoading;
const hasError = presetError || holidayError || categoryError;
```

- [ ] **Step 4: Add delete mutation**

Add:

```ts
const deleteCategoryMutation = useMutation({
	mutationFn: (assignmentId: string) => deleteHolidayCategoryAssignment(assignmentId),
	onSuccess: (result) => {
		if (result.success) {
			toast.success(t("settings.holidays.assignments.categoryDeleted", "Holiday category assignment removed"));
			queryClient.invalidateQueries({
				queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
			});
			setDeleteDialogOpen(false);
			setSelectedCategoryAssignment(null);
		} else {
			toast.error(
				result.error ||
					t(
						"settings.holidays.assignments.categoryDeleteFailed",
						"Failed to remove holiday category assignment",
					),
			);
		}
	},
	onError: () => {
		toast.error(
			t(
				"settings.holidays.assignments.categoryDeleteFailed",
				"Failed to remove holiday category assignment",
			),
		);
	},
});
```

Update `isDeleting`:

```ts
const isDeleting =
	deletePresetMutation.isPending || deleteHolidayMutation.isPending || deleteCategoryMutation.isPending;
```

Update delete handlers:

```ts
const handleDeleteCategoryClick = (assignment: HolidayCategoryAssignmentData) => {
	setSelectedCategoryAssignment(assignment);
	setSelectedPresetAssignment(null);
	setSelectedHolidayAssignment(null);
	setDeleteDialogOpen(true);
};

const handleDeleteConfirm = () => {
	if (selectedPresetAssignment) {
		deletePresetMutation.mutate(selectedPresetAssignment.id);
	} else if (selectedHolidayAssignment) {
		deleteHolidayMutation.mutate(selectedHolidayAssignment.id);
	} else if (selectedCategoryAssignment) {
		deleteCategoryMutation.mutate(selectedCategoryAssignment.id);
	}
};
```

- [ ] **Step 5: Group category assignments by scope**

Add after holiday grouping:

```ts
const categories = categoryAssignments || [];
const orgCategoryAssignments = categories.filter((a) => a.assignmentType === "organization");
const teamCategoryAssignments = categories.filter((a) => a.assignmentType === "team");
const employeeCategoryAssignments = categories.filter((a) => a.assignmentType === "employee");
```

- [ ] **Step 6: Display category assignments in the Custom Holidays sections**

For organization custom holidays, change badge and empty conditions to include `orgCategoryAssignments`. Use this row markup before legacy direct holiday rows:

```tsx
{orgCategoryAssignments.map((assignment) => (
	<div key={assignment.id} className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50">
		<div className="flex items-center gap-3">
			{assignment.category.color ? (
				<span className="size-3 rounded-full" style={{ backgroundColor: assignment.category.color }} />
			) : (
				<IconCalendarEvent className="size-4 text-muted-foreground" />
			)}
			<div>
				<span className="font-medium">{assignment.category.name}</span>
				<Badge variant="outline" className="ml-2">
					{t("settings.holidays.assignments.categoryBadge", "Category")}
				</Badge>
			</div>
		</div>
		{canManage ? (
			<Button
				variant="ghost"
				size="icon"
				className="size-8 text-muted-foreground hover:text-destructive"
				onClick={() => handleDeleteCategoryClick(assignment)}
				aria-label={t(
					"settings.holidays.assignments.removeCategoryAssignment",
					'Remove category assignment for "{category}"',
					{ category: assignment.category.name },
				)}
			>
				<IconTrash className="size-4" />
			</Button>
		) : null}
	</div>
))}
```

For team rows, use `assignment.team?.name → assignment.category.name`. For employee rows, use employee full name `→ assignment.category.name`. Keep direct `holidayAssignments` rendering after category assignments under a small legacy label if desired:

```tsx
{orgHolidayAssignments.length > 0 ? (
	<p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
		{t("settings.holidays.assignments.legacySingleHolidays", "Single holiday assignments")}
	</p>
) : null}
```

Update Add buttons from `Assign Holiday` / `Add Holiday` to:

```tsx
{t("settings.holidays.assignments.assignCategory", "Assign Category")}
```

- [ ] **Step 7: Update delete dialog description**

In `AlertDialogDescription`, add:

```tsx
{selectedCategoryAssignment &&
	t(
		"settings.holidays.assignments.deleteCategoryDescription",
		'This will remove the custom holiday category "{category}" from this assignment.',
		{ category: selectedCategoryAssignment.category.name },
	)}
```

- [ ] **Step 8: Update `holiday-management.tsx` invalidation**

In `handleHolidayAssignmentSuccess`, add category assignment invalidation:

```ts
queryClient.invalidateQueries({
	queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
});
```

- [ ] **Step 9: Run TypeScript**

Run: `pnpm -C apps/webapp exec tsc --noEmit`

Expected: PASS, or only unrelated pre-existing errors. Fix all errors introduced in `assignment-manager.tsx` and `holiday-management.tsx`.

- [ ] **Step 10: Commit manager UI**

```bash
git add "apps/webapp/src/components/settings/assignment-manager.tsx" "apps/webapp/src/components/settings/holiday-management.tsx"
git commit -m "feat: show custom holiday category assignments"
```

## Task 6: Final Verification

**Files:**
- Verify changed files only; no new files expected.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm -C apps/webapp test src/app/[locale]/\(app\)/settings/holidays/actions.behavior.test.ts src/lib/calendar/assigned-holidays.test.ts -- --run
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript**

Run: `pnpm -C apps/webapp exec tsc --noEmit`

Expected: PASS, or document unrelated pre-existing failures with exact file paths. Do not ignore failures in files touched by this plan.

- [ ] **Step 3: Inspect final diff**

Run: `git status --short`

Expected: only files from this plan should be staged or modified by this implementation. Unrelated existing worktree changes may remain; do not revert them.

Run: `git diff --stat`

Expected: includes schema, migration, server action, assigned holiday, query key, and settings UI files from this plan.

- [ ] **Step 4: Commit verification fixes if needed**

If verification required fixes, commit them:

```bash
git add "apps/webapp/src/db/schema/holiday.ts" "apps/webapp/src/db/schema/relations.ts" "apps/webapp/drizzle/0037_holiday_category_assignment.sql" "apps/webapp/drizzle/meta/_journal.json" "apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts" "apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.behavior.test.ts" "apps/webapp/src/lib/calendar/assigned-holidays.ts" "apps/webapp/src/lib/calendar/assigned-holidays.test.ts" "apps/webapp/src/lib/query/keys.ts" "apps/webapp/src/components/settings/holiday-assignment-dialog.tsx" "apps/webapp/src/components/settings/assignment-manager.tsx" "apps/webapp/src/components/settings/holiday-management.tsx"
git commit -m "fix: verify holiday category assignments"
```

Expected: commit succeeds, or no commit is needed because previous task commits already contain all verified changes.

## Self-Review

- Spec coverage: schema, server actions, read expansion, UI, errors, and tests all map to Tasks 1-6.
- Placeholder scan: no TBD/TODO/later placeholders are present; each task has exact files, commands, and concrete code snippets.
- Type consistency: the plan consistently uses `holidayCategoryAssignment`, `categoryId`, `getHolidayCategoryAssignments`, `createHolidayCategoryAssignment`, `deleteHolidayCategoryAssignment`, and `queryKeys.holidayCategoryAssignments`.
