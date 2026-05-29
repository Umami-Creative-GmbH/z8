# Work Policy Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Work Policy Presets library where org admins can browse system presets, create organization-owned custom presets, review preset values before saving, and create real work policies from reviewed presets.

**Architecture:** Extend the existing `work_policy_preset` table so system presets have `organization_id = null` and custom presets are scoped to one organization. Add server actions that enforce org-admin authorization and org-scoped uniqueness, then replace the current import grid with a library and review dialog. Keep presets as templates only; only real work-policy creation marks work balances dirty.

**Tech Stack:** Next.js server actions, Drizzle ORM, Effect services, TanStack Query, TanStack Form, Vitest, pnpm, PostgreSQL migrations.

---

## File Structure

- Modify: `apps/webapp/src/db/schema/work-policy.ts`
  - Add nullable `organizationId` to `workPolicyPreset`.
  - Replace the current global unique `name` constraint with system and organization uniqueness indexes.
- Create: `apps/webapp/drizzle/0037_work_policy_preset_ownership.sql`
  - Add `organization_id`, drop global unique name constraint, add FK and partial unique indexes.
- Modify: `apps/webapp/drizzle/meta/_journal.json`
  - Add migration entry `0037_work_policy_preset_ownership` with a `when` greater than `1780185600000`.
- Modify: `apps/webapp/src/db/seed/work-policy-presets.ts`
  - Upsert/refresh system presets without deleting organization-owned custom presets.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`
  - Add preset input/types and explicit preset CRUD/copy/use-as-policy actions.
  - Update `getWorkPolicyPresets` to accept `organizationId`.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`
  - Add server-action coverage for org scoping, system preset protection, duplicate names, reviewed input, and dirty marking.
- Create: `apps/webapp/src/components/settings/work-policy-preset-utils.ts`
  - Add pure helpers for preset source classification, summaries, search/filtering, and default review values.
- Create: `apps/webapp/src/components/settings/work-policy-preset-utils.test.ts`
  - Unit tests for those pure helpers.
- Replace: `apps/webapp/src/components/settings/work-policy-preset-import.tsx`
  - Keep the exported component name `WorkPolicyPresetImport` because `work-policy-management.tsx` already imports it, but replace its internals with the preset library UI.
- Create: `apps/webapp/src/components/settings/work-policy-preset-review-dialog.tsx`
  - TanStack Form review dialog for create custom preset, edit custom preset, copy system preset, and use as policy.
- Create: `apps/webapp/src/components/settings/work-policy-preset-import.test.tsx`
  - UI tests for library filtering/actions and review dialog validation.
- Modify: `apps/webapp/src/lib/query/keys.ts`
  - Change preset query key to include `organizationId`.
- Modify: `apps/docs/content/docs/guide/admin-guide/work-policies.mdx`
  - Update docs to describe the Presets tab library and custom preset behavior.

---

### Task 1: Preset Ownership Schema And Migration

**Files:**
- Modify: `apps/webapp/src/db/schema/work-policy.ts:1-12,423-451`
- Create: `apps/webapp/drizzle/0037_work_policy_preset_ownership.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json:257-263`

- [ ] **Step 1: Write the schema test expectation in the server-action mock**

Update the schema mock in `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts` so upcoming action tests can reference `organizationId`, `countryCode`, and preset limit columns. This is not expected to fail by itself, but it prevents the preset action tests from using undefined mocked columns.

```ts
workPolicyPreset: {
	id: "id",
	organizationId: "organizationId",
	isActive: "isActive",
	name: "name",
	description: "description",
	countryCode: "countryCode",
	scheduleCycle: "scheduleCycle",
	workingDaysPreset: "workingDaysPreset",
	hoursPerCycle: "hoursPerCycle",
	maxDailyMinutes: "maxDailyMinutes",
	maxWeeklyMinutes: "maxWeeklyMinutes",
	maxUninterruptedMinutes: "maxUninterruptedMinutes",
	breakRulesJson: "breakRulesJson",
},
```

- [ ] **Step 2: Run the current scope tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: PASS or existing unrelated failures only. If this exact test file fails because the mock syntax is invalid, fix the mock before continuing.

- [ ] **Step 3: Update the Drizzle schema**

In `apps/webapp/src/db/schema/work-policy.ts`, add `organizationId` to `workPolicyPreset` and replace the global `.unique()` name column with partial unique indexes.

```ts
export const workPolicyPreset = pgTable(
	"work_policy_preset",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),

		name: text("name").notNull(),
		description: text("description"),
		countryCode: text("country_code"),

		scheduleCycle: scheduleCycleEnum("schedule_cycle").default("weekly"),
		workingDaysPreset: workingDaysPresetEnum("working_days_preset").default("weekdays"),
		hoursPerCycle: decimal("hours_per_cycle", { precision: 6, scale: 2 }),

		maxDailyMinutes: integer("max_daily_minutes"),
		maxWeeklyMinutes: integer("max_weekly_minutes"),
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes"),
		breakRulesJson: text("break_rules_json").$type<TimeRegulationBreakRulesPreset>(),

		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workPolicyPreset_organizationId_idx").on(table.organizationId),
		index("workPolicyPreset_countryCode_idx").on(table.countryCode),
		index("workPolicyPreset_isActive_idx").on(table.isActive),
		uniqueIndex("workPolicyPreset_system_name_idx")
			.on(table.name)
			.where(sql`${table.organizationId} IS NULL`),
		uniqueIndex("workPolicyPreset_org_name_idx")
			.on(table.organizationId, table.name)
			.where(sql`${table.organizationId} IS NOT NULL`),
	],
);
```

- [ ] **Step 4: Add the SQL migration**

Create `apps/webapp/drizzle/0037_work_policy_preset_ownership.sql`.

```sql
ALTER TABLE "work_policy_preset" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "work_policy_preset" ADD CONSTRAINT "work_policy_preset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_preset" DROP CONSTRAINT IF EXISTS "work_policy_preset_name_unique";--> statement-breakpoint
CREATE INDEX "workPolicyPreset_organizationId_idx" ON "work_policy_preset" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyPreset_system_name_idx" ON "work_policy_preset" USING btree ("name") WHERE "organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyPreset_org_name_idx" ON "work_policy_preset" USING btree ("organization_id","name") WHERE "organization_id" IS NOT NULL;
```

- [ ] **Step 5: Add the journal entry**

Append this entry after `0036_time_entry_timezone_capture` in `apps/webapp/drizzle/meta/_journal.json`. Ensure the prior entry has a trailing comma.

```json
{
  "idx": 37,
  "version": "7",
  "when": 1780185600001,
  "tag": "0037_work_policy_preset_ownership",
  "breakpoints": true
}
```

- [ ] **Step 6: Run schema-related checks**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: PASS or only existing unrelated failures. There should be no TypeScript/runtime errors from the schema mock.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/db/schema/work-policy.ts apps/webapp/drizzle/0037_work_policy_preset_ownership.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts
git commit -m "feat: add work policy preset ownership"
```

---

### Task 2: Seed System Presets Without Deleting Custom Presets

**Files:**
- Modify: `apps/webapp/src/db/seed/work-policy-presets.ts:9-223`

- [ ] **Step 1: Update the seed logic**

Replace the delete-and-reinsert logic in `seedWorkPolicyPresets` with a system-only upsert by name. This keeps organization-owned custom presets intact.

```ts
export async function seedWorkPolicyPresets() {
	console.log("  Seeding work policy presets...");

	let upserted = 0;

	for (const preset of workPolicyPresetsData) {
		const values = {
			organizationId: null,
			name: preset.name,
			description: preset.description,
			countryCode: preset.countryCode,
			maxDailyMinutes: preset.maxDailyMinutes,
			maxWeeklyMinutes: preset.maxWeeklyMinutes,
			maxUninterruptedMinutes: preset.maxUninterruptedMinutes,
			breakRulesJson: JSON.stringify(preset.breakRulesJson) as unknown as typeof preset.breakRulesJson,
			isActive: true,
		};

		const existingSystemPreset = await db.query.workPolicyPreset.findFirst({
			where: and(isNull(workPolicyPreset.organizationId), eq(workPolicyPreset.name, preset.name)),
		});

		if (existingSystemPreset) {
			await db
				.update(workPolicyPreset)
				.set(values)
				.where(eq(workPolicyPreset.id, existingSystemPreset.id));
			console.log(`    ~ Updated preset: ${preset.name}`);
		} else {
			await db.insert(workPolicyPreset).values(values);
			console.log(`    + Created preset: ${preset.name}`);
		}

		upserted++;
	}

	console.log(`  Done: ${upserted} system presets upserted`);
}
```

- [ ] **Step 2: Fix imports**

Update the imports at the top of `apps/webapp/src/db/seed/work-policy-presets.ts`.

```ts
import { and, eq, isNull } from "drizzle-orm";
```

- [ ] **Step 3: Run a focused type/test check**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: PASS or only existing unrelated failures. The seed file should also typecheck during the final build in Task 7.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/db/seed/work-policy-presets.ts
git commit -m "fix: preserve custom work policy presets during seed"
```

---

### Task 3: Preset Server Actions

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts:111-165,1131-1529`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

- [ ] **Step 1: Write failing visibility and authorization tests**

Add these tests near the existing work-policy scope tests in `actions.scope.test.ts`.

```ts
it("returns active system and organization work policy presets for org admins", async () => {
	mockState.actor.accessTier = "orgAdmin";
	mockState.workPolicyPresets = [
		{ id: "system-1", organizationId: null, name: "German Labor Law", isActive: true },
		{ id: "custom-1", organizationId: "org-1", name: "Retail 38h", isActive: true },
	];

	const { getWorkPolicyPresets } = await import("./actions");
	const result = await getWorkPolicyPresets("org-1");

	expect(result).toMatchObject({ success: true, data: mockState.workPolicyPresets });
});

it("rejects custom preset creation for non-admin settings actors", async () => {
	mockState.actor.accessTier = "manager";

	const { createWorkPolicyPreset } = await import("./actions");
	const result = await createWorkPolicyPreset("org-1", {
		name: "Retail 38h",
		description: "Retail template",
		scheduleEnabled: true,
		regulationEnabled: true,
		schedule: {
			scheduleCycle: "weekly",
			workingDaysPreset: "weekdays",
			hoursPerCycle: "38",
		},
		regulation: {
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			maxUninterruptedMinutes: 360,
			breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }],
		},
	});

	expect(result).toMatchObject({ success: false, code: "AUTHORIZATION_ERROR" });
});
```

Add `workPolicyPresets` to `mockState` and make `db.query.workPolicyPreset.findMany` return it.

```ts
workPolicyPresets: [] as Array<any>,
```

```ts
findMany: vi.fn(async () => mockState.workPolicyPresets),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: FAIL because `createWorkPolicyPreset` does not exist and `getWorkPolicyPresets` still has no `organizationId` parameter.

- [ ] **Step 3: Add preset input types**

In `actions.ts`, add types after `CreateWorkPolicyInput`.

```ts
export interface WorkPolicyPresetInput {
	name: string;
	description?: string;
	countryCode?: string | null;
	scheduleEnabled: boolean;
	regulationEnabled: boolean;
	schedule?: {
		scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
		workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
		hoursPerCycle?: string;
	};
	regulation?: {
		maxDailyMinutes?: number;
		maxWeeklyMinutes?: number;
		maxUninterruptedMinutes?: number;
		breakRules: BreakRuleInput[];
	};
}

export type WorkPolicyPresetWithSource = typeof workPolicyPreset.$inferSelect & {
	source: "system" | "custom";
};
```

- [ ] **Step 4: Add helper functions inside `actions.ts` near the Presets section**

```ts
function normalizePresetName(name: string) {
	return name.trim();
}

function stringifyPresetBreakRules(input: WorkPolicyPresetInput) {
	const rules = input.regulationEnabled ? (input.regulation?.breakRules ?? []) : [];
	return JSON.stringify({ rules }) as unknown as TimeRegulationBreakRulesPreset;
}

function presetInputToPolicyInput(input: WorkPolicyPresetInput): CreateWorkPolicyInput {
	return {
		name: normalizePresetName(input.name),
		description: input.description?.trim() || undefined,
		scheduleEnabled: input.scheduleEnabled,
		regulationEnabled: input.regulationEnabled,
		presenceEnabled: false,
		schedule: input.scheduleEnabled
			? {
					scheduleCycle: input.schedule?.scheduleCycle ?? "weekly",
					scheduleType: "simple",
					workingDaysPreset: input.schedule?.workingDaysPreset ?? "weekdays",
					hoursPerCycle: input.schedule?.hoursPerCycle ?? "40",
					homeOfficeDaysPerCycle: 0,
				}
			: undefined,
		regulation: input.regulationEnabled
			? {
					maxDailyMinutes: input.regulation?.maxDailyMinutes,
					maxWeeklyMinutes: input.regulation?.maxWeeklyMinutes,
					maxUninterruptedMinutes: input.regulation?.maxUninterruptedMinutes,
					breakRules: input.regulation?.breakRules ?? [],
				}
			: undefined,
	};
}
```

Add `TimeRegulationBreakRulesPreset` to the existing type import from `@/db/schema/types` in `actions.ts`.

- [ ] **Step 5: Implement `getWorkPolicyPresets(organizationId)`**

Replace the existing no-arg action with org-scoped read behavior.

```ts
export async function getWorkPolicyPresets(
	organizationId: string,
): Promise<ServerActionResult<WorkPolicyPresetWithSource[]>> {
	const effect = Effect.gen(function* (_) {
		yield* _(getEmployeeSettingsActorContext({ organizationId, queryName: "getWorkPolicyPresets:actor" }));

		const dbService = yield* _(DatabaseService);
		const presets = yield* _(
			dbService.query("getWorkPolicyPresets", async () => {
				return await dbService.db.query.workPolicyPreset.findMany({
					where: and(
						eq(workPolicyPreset.isActive, true),
						or(isNull(workPolicyPreset.organizationId), eq(workPolicyPreset.organizationId, organizationId)),
					),
					orderBy: [workPolicyPreset.name],
				});
			}),
		);

		return presets.map((preset) => ({
			...preset,
			source: preset.organizationId ? "custom" : "system",
		})) satisfies WorkPolicyPresetWithSource[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 6: Add `createWorkPolicyPreset`**

```ts
export async function createWorkPolicyPreset(
	organizationId: string,
	input: WorkPolicyPresetInput,
): Promise<ServerActionResult<typeof workPolicyPreset.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ organizationId, queryName: "createWorkPolicyPreset:actor" }));
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, { message: "Insufficient permissions", resource: "work_policy_preset", action: "create" }));

		const dbService = yield* _(DatabaseService);
		const name = normalizePresetName(input.name);
		if (!name) {
			return yield* _(Effect.fail(new ValidationError({ message: "Preset name is required", field: "name" })));
		}

		const existing = yield* _(dbService.query("getExistingWorkPolicyPresetName", async () => {
			return await dbService.db.query.workPolicyPreset.findFirst({
				where: and(eq(workPolicyPreset.organizationId, organizationId), eq(workPolicyPreset.name, name), eq(workPolicyPreset.isActive, true)),
			});
		}));

		if (existing) {
			return yield* _(Effect.fail(new ConflictError({ message: "A preset with this name already exists", resource: "work_policy_preset" })));
		}

		const [created] = yield* _(dbService.query("createWorkPolicyPreset", async () => {
			return await dbService.db.insert(workPolicyPreset).values({
				organizationId,
				name,
				description: input.description?.trim() || null,
				countryCode: input.countryCode || null,
				scheduleCycle: input.scheduleEnabled ? (input.schedule?.scheduleCycle ?? "weekly") : null,
				workingDaysPreset: input.scheduleEnabled ? (input.schedule?.workingDaysPreset ?? "weekdays") : null,
				hoursPerCycle: input.scheduleEnabled ? (input.schedule?.hoursPerCycle ?? null) : null,
				maxDailyMinutes: input.regulationEnabled ? (input.regulation?.maxDailyMinutes ?? null) : null,
				maxWeeklyMinutes: input.regulationEnabled ? (input.regulation?.maxWeeklyMinutes ?? null) : null,
				maxUninterruptedMinutes: input.regulationEnabled ? (input.regulation?.maxUninterruptedMinutes ?? null) : null,
				breakRulesJson: stringifyPresetBreakRules(input),
				isActive: true,
			}).returning();
		}));

		return created;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: The two new tests pass. The update/archive/copy/use-as-policy actions are not implemented until the next steps in this task.

- [ ] **Step 8: Add update/archive/copy/use-as-policy tests**

Add focused tests for system preset protection, ownership, reviewed input, and dirty marking. Use mock queues rather than asserting SQL internals.

```ts
it("rejects archiving a system preset", async () => {
	mockState.actor.accessTier = "orgAdmin";
	mockState.workPolicyQueue = [];
	mockState.workPolicyPresetQueue = [{ id: "system-1", organizationId: null, name: "System", isActive: true }];

	const { archiveWorkPolicyPreset } = await import("./actions");
	const result = await archiveWorkPolicyPreset("org-1", "system-1");

	expect(result).toMatchObject({ success: false });
});

it("creates a work policy from reviewed preset input and marks balances dirty", async () => {
	mockState.actor.accessTier = "orgAdmin";
	mockState.isOrgAdmin = true;
	mockState.workPolicyPresetQueue = [{ id: "system-1", organizationId: null, name: "System", isActive: true }];
	mockState.insertQueue = [{ id: "policy-1", organizationId: "org-1", name: "Reviewed Name", isActive: true }];

	const { createWorkPolicyFromPreset } = await import("./actions");
	const result = await createWorkPolicyFromPreset("org-1", "system-1", {
		name: "Reviewed Name",
		description: "Reviewed description",
		scheduleEnabled: false,
		regulationEnabled: true,
		regulation: { maxDailyMinutes: 480, maxWeeklyMinutes: 2400, maxUninterruptedMinutes: 300, breakRules: [{ workingMinutesThreshold: 300, requiredBreakMinutes: 15, options: [] }] },
	}, false);

	expect(result.success).toBe(true);
	expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
});
```

Add `workPolicyPresetQueue` to `mockState` and make `findFirst` shift from it.

```ts
workPolicyPresetQueue: [] as Array<any>,
```

```ts
findFirst: vi.fn(async () => mockState.workPolicyPresetQueue.shift() ?? null),
```

- [ ] **Step 9: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: FAIL because `archiveWorkPolicyPreset` and `createWorkPolicyFromPreset` do not exist yet.

- [ ] **Step 10: Implement update/archive/copy/use-as-policy actions**

Implement the remaining actions in `actions.ts` after `createWorkPolicyPreset`.

```ts
export async function updateWorkPolicyPreset(organizationId: string, presetId: string, input: WorkPolicyPresetInput): Promise<ServerActionResult<typeof workPolicyPreset.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ organizationId, queryName: "updateWorkPolicyPreset:actor" }));
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, { message: "Insufficient permissions", resource: "work_policy_preset", action: "update" }));
		const dbService = yield* _(DatabaseService);
		const preset = yield* _(dbService.query("getWorkPolicyPresetForUpdate", async () => await dbService.db.query.workPolicyPreset.findFirst({ where: eq(workPolicyPreset.id, presetId) })));
		if (!preset) return yield* _(Effect.fail(new NotFoundError({ message: "Preset not found", entityType: "work_policy_preset", entityId: presetId })));
		if (preset.organizationId !== organizationId) return yield* _(Effect.fail(new AuthorizationError({ message: "Cannot edit this preset", userId: actor.session.user.id, resource: "work_policy_preset", action: "update" })));
		const [updated] = yield* _(dbService.query("updateWorkPolicyPreset", async () => await dbService.db.update(workPolicyPreset).set({ name: normalizePresetName(input.name), description: input.description?.trim() || null, countryCode: input.countryCode || null, scheduleCycle: input.scheduleEnabled ? (input.schedule?.scheduleCycle ?? "weekly") : null, workingDaysPreset: input.scheduleEnabled ? (input.schedule?.workingDaysPreset ?? "weekdays") : null, hoursPerCycle: input.scheduleEnabled ? (input.schedule?.hoursPerCycle ?? null) : null, maxDailyMinutes: input.regulationEnabled ? (input.regulation?.maxDailyMinutes ?? null) : null, maxWeeklyMinutes: input.regulationEnabled ? (input.regulation?.maxWeeklyMinutes ?? null) : null, maxUninterruptedMinutes: input.regulationEnabled ? (input.regulation?.maxUninterruptedMinutes ?? null) : null, breakRulesJson: stringifyPresetBreakRules(input) }).where(and(eq(workPolicyPreset.id, presetId), eq(workPolicyPreset.organizationId, organizationId))).returning())));
		return updated;
	}).pipe(Effect.provide(AppLayer));
	return runServerActionSafe(effect);
}

export async function archiveWorkPolicyPreset(organizationId: string, presetId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ organizationId, queryName: "archiveWorkPolicyPreset:actor" }));
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, { message: "Insufficient permissions", resource: "work_policy_preset", action: "delete" }));
		const dbService = yield* _(DatabaseService);
		const preset = yield* _(dbService.query("getWorkPolicyPresetForArchive", async () => await dbService.db.query.workPolicyPreset.findFirst({ where: eq(workPolicyPreset.id, presetId) })));
		if (!preset) return yield* _(Effect.fail(new NotFoundError({ message: "Preset not found", entityType: "work_policy_preset", entityId: presetId })));
		if (preset.organizationId !== organizationId) return yield* _(Effect.fail(new AuthorizationError({ message: "Cannot archive this preset", userId: actor.session.user.id, resource: "work_policy_preset", action: "delete" })));
		yield* _(dbService.query("archiveWorkPolicyPreset", async () => { await dbService.db.update(workPolicyPreset).set({ isActive: false }).where(and(eq(workPolicyPreset.id, presetId), eq(workPolicyPreset.organizationId, organizationId))); }));
	}).pipe(Effect.provide(AppLayer));
	return runServerActionSafe(effect);
}

export async function copySystemWorkPolicyPreset(organizationId: string, presetId: string, input: WorkPolicyPresetInput): Promise<ServerActionResult<typeof workPolicyPreset.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ organizationId, queryName: "copySystemWorkPolicyPreset:actor" }));
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, { message: "Insufficient permissions", resource: "work_policy_preset", action: "create" }));
		const dbService = yield* _(DatabaseService);
		const source = yield* _(dbService.query("getSystemWorkPolicyPresetForCopy", async () => await dbService.db.query.workPolicyPreset.findFirst({ where: and(eq(workPolicyPreset.id, presetId), isNull(workPolicyPreset.organizationId), eq(workPolicyPreset.isActive, true)) })));
		if (!source) return yield* _(Effect.fail(new NotFoundError({ message: "System preset not found", entityType: "work_policy_preset", entityId: presetId })));
		return yield* _(Effect.promise(() => createWorkPolicyPreset(organizationId, input)).pipe(Effect.flatMap((result) => result.success ? Effect.succeed(result.data) : Effect.fail(new ValidationError({ message: result.error ?? "Failed to copy preset", field: "preset" })))));
	}).pipe(Effect.provide(AppLayer));
	return runServerActionSafe(effect);
}

export async function createWorkPolicyFromPreset(organizationId: string, presetId: string, input: WorkPolicyPresetInput, setAsDefault = false): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ organizationId, queryName: "createWorkPolicyFromPreset:actor" }));
		yield* _(requireOrgAdminEmployeeSettingsAccess(actor, { message: "Insufficient permissions", resource: "work_policy", action: "create" }));
		const dbService = yield* _(DatabaseService);
		const source = yield* _(dbService.query("getWorkPolicyPresetForPolicyCreate", async () => await dbService.db.query.workPolicyPreset.findFirst({ where: and(eq(workPolicyPreset.id, presetId), eq(workPolicyPreset.isActive, true), or(isNull(workPolicyPreset.organizationId), eq(workPolicyPreset.organizationId, organizationId))) })));
		if (!source) return yield* _(Effect.fail(new NotFoundError({ message: "Preset not found", entityType: "work_policy_preset", entityId: presetId })));
		const createResult = yield* _(Effect.promise(() => createWorkPolicy(organizationId, presetInputToPolicyInput(input))));
		if (!createResult.success) return yield* _(Effect.fail(new ValidationError({ message: createResult.error ?? "Failed to create policy from preset", field: "preset" })));
		if (setAsDefault) {
			const setDefaultResult = yield* _(Effect.promise(() => setDefaultWorkPolicy(createResult.data.id)));
			if (!setDefaultResult.success) return yield* _(Effect.fail(new ValidationError({ message: setDefaultResult.error ?? "Failed to set policy as default", field: "setAsDefault" })));
		}
		return createResult.data;
	}).pipe(Effect.provide(AppLayer));
	return runServerActionSafe(effect);
}
```

- [ ] **Step 11: Keep a compatibility wrapper for old `importWorkPolicyPreset` callers**

During this task, keep `importWorkPolicyPreset` as a thin wrapper around `createWorkPolicyFromPreset` so the existing Presets tab continues to compile until Task 6 replaces the old import UI. After Task 6 removes all imports of `importWorkPolicyPreset`, delete this wrapper in the same Task 6 commit.

```ts
export async function importWorkPolicyPreset(organizationId: string, presetId: string, setAsDefault = false): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const presets = await getWorkPolicyPresets(organizationId);
	if (!presets.success) return { success: false, error: presets.error, code: presets.code };
	const source = presets.data.find((preset) => preset.id === presetId);
	if (!source) return { success: false, error: "Preset not found", code: "NOT_FOUND_ERROR" };
	return createWorkPolicyFromPreset(organizationId, presetId, presetToInput(source), setAsDefault);
}
```

Define `presetToInput` in `actions.ts` so the wrapper parses `breakRulesJson` into `WorkPolicyPresetInput`.

- [ ] **Step 12: Run focused server tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts`

Expected: PASS. If failures show mocked Drizzle chains missing `.returning()`, update the mock `update` chain to include `returning: vi.fn(async () => mockState.updateQueue.shift() ?? [])` and add `updateQueue` to `mockState`.

- [ ] **Step 13: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts
git commit -m "feat: add work policy preset actions"
```

---

### Task 4: Preset Pure Utilities

**Files:**
- Create: `apps/webapp/src/components/settings/work-policy-preset-utils.ts`
- Create: `apps/webapp/src/components/settings/work-policy-preset-utils.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create `apps/webapp/src/components/settings/work-policy-preset-utils.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { buildPresetReviewValues, filterWorkPolicyPresets, getPresetSource, summarizeBreakRules, summarizeMinutes } from "./work-policy-preset-utils";

describe("work policy preset utilities", () => {
	it("classifies system and custom presets", () => {
		expect(getPresetSource({ organizationId: null })).toBe("system");
		expect(getPresetSource({ organizationId: "org-1" })).toBe("custom");
	});

	it("filters by source, country, name, and description", () => {
		const presets = [
			{ id: "system-de", organizationId: null, name: "German Labor Law", description: "ArbZG", countryCode: "DE" },
			{ id: "custom-retail", organizationId: "org-1", name: "Retail 38h", description: "Store teams", countryCode: "DE" },
		];

		expect(filterWorkPolicyPresets(presets, { search: "retail", source: "custom", countryCode: "DE" })).toEqual([presets[1]]);
	});

	it("builds editable review values from a system preset", () => {
		const values = buildPresetReviewValues({
			id: "system-1",
			organizationId: null,
			name: "German Labor Law",
			description: "ArbZG",
			countryCode: "DE",
			scheduleCycle: "weekly",
			workingDaysPreset: "weekdays",
			hoursPerCycle: "40",
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			maxUninterruptedMinutes: 360,
			breakRulesJson: JSON.stringify({ rules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }] }),
		});

		expect(values).toMatchObject({ name: "German Labor Law", scheduleEnabled: true, regulationEnabled: true, countryCode: "DE" });
		expect(values.regulation?.breakRules).toHaveLength(1);
	});

	it("formats minutes and break summaries", () => {
		expect(summarizeMinutes(600)).toBe("10h");
		expect(summarizeMinutes(615)).toBe("10h 15m");
		expect(summarizeBreakRules([{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }])).toBe("30m after 6h");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-utils.test.ts`

Expected: FAIL because the utility file does not exist.

- [ ] **Step 3: Implement utilities**

Create `apps/webapp/src/components/settings/work-policy-preset-utils.ts`.

```ts
import type { BreakRuleInput, WorkPolicyPresetInput } from "@/app/[locale]/(app)/settings/work-policies/actions";

type PresetLike = {
	id?: string;
	organizationId: string | null;
	name: string;
	description?: string | null;
	countryCode?: string | null;
	scheduleCycle?: "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | null;
	workingDaysPreset?: "weekdays" | "weekends" | "all_days" | "custom" | null;
	hoursPerCycle?: string | null;
	maxDailyMinutes?: number | null;
	maxWeeklyMinutes?: number | null;
	maxUninterruptedMinutes?: number | null;
	breakRulesJson?: unknown;
};

export type PresetSourceFilter = "all" | "system" | "custom";

export function getPresetSource(preset: Pick<PresetLike, "organizationId">) {
	return preset.organizationId ? "custom" : "system";
}

export function summarizeMinutes(minutes: number | null | undefined) {
	if (minutes == null) return "-";
	const hours = Math.floor(minutes / 60);
	const remaining = minutes % 60;
	return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
}

export function parsePresetBreakRules(value: unknown): BreakRuleInput[] {
	if (!value) return [];
	const parsed = typeof value === "string" ? JSON.parse(value) : value;
	if (!parsed || typeof parsed !== "object" || !("rules" in parsed) || !Array.isArray(parsed.rules)) return [];
	return parsed.rules;
}

export function summarizeBreakRules(rules: BreakRuleInput[]) {
	if (rules.length === 0) return "No break rules";
	return rules
		.map((rule) => `${summarizeMinutes(rule.requiredBreakMinutes).replace("h", "h ").trim()} after ${summarizeMinutes(rule.workingMinutesThreshold)}`)
		.join(", ");
}

export function buildPresetReviewValues(preset?: Partial<PresetLike>): WorkPolicyPresetInput {
	const breakRules = parsePresetBreakRules(preset?.breakRulesJson);
	return {
		name: preset?.name ?? "",
		description: preset?.description ?? "",
		countryCode: preset?.countryCode ?? null,
		scheduleEnabled: Boolean(preset?.scheduleCycle || preset?.hoursPerCycle),
		regulationEnabled: Boolean(preset?.maxDailyMinutes || preset?.maxWeeklyMinutes || preset?.maxUninterruptedMinutes || breakRules.length),
		schedule: {
			scheduleCycle: preset?.scheduleCycle ?? "weekly",
			workingDaysPreset: preset?.workingDaysPreset ?? "weekdays",
			hoursPerCycle: preset?.hoursPerCycle ?? "40",
		},
		regulation: {
			maxDailyMinutes: preset?.maxDailyMinutes ?? undefined,
			maxWeeklyMinutes: preset?.maxWeeklyMinutes ?? undefined,
			maxUninterruptedMinutes: preset?.maxUninterruptedMinutes ?? undefined,
			breakRules,
		},
	};
}

export function filterWorkPolicyPresets<T extends PresetLike>(presets: T[], filters: { search: string; source: PresetSourceFilter; countryCode: string }) {
	const search = filters.search.trim().toLowerCase();
	return presets.filter((preset) => {
		const source = getPresetSource(preset);
		const matchesSource = filters.source === "all" || filters.source === source;
		const matchesCountry = filters.countryCode === "all" || preset.countryCode === filters.countryCode;
		const matchesSearch = !search || preset.name.toLowerCase().includes(search) || (preset.description ?? "").toLowerCase().includes(search);
		return matchesSource && matchesCountry && matchesSearch;
	});
}
```

- [ ] **Step 4: Run utility tests**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-utils.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/work-policy-preset-utils.ts apps/webapp/src/components/settings/work-policy-preset-utils.test.ts
git commit -m "feat: add work policy preset utilities"
```

---

### Task 5: Preset Review Dialog

**Files:**
- Create: `apps/webapp/src/components/settings/work-policy-preset-review-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/work-policy-preset-import.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create `apps/webapp/src/components/settings/work-policy-preset-import.test.tsx` with a first test that renders the dialog directly and submits reviewed values. Mock Tolgee with identity fallback and server actions with spies.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkPolicyPresetReviewDialog } from "./work-policy-preset-review-dialog";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const createWorkPolicyPreset = vi.fn();
const createWorkPolicyFromPreset = vi.fn();
const updateWorkPolicyPreset = vi.fn();
const copySystemWorkPolicyPreset = vi.fn();

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	createWorkPolicyPreset: (...args: unknown[]) => createWorkPolicyPreset(...args),
	createWorkPolicyFromPreset: (...args: unknown[]) => createWorkPolicyFromPreset(...args),
	updateWorkPolicyPreset: (...args: unknown[]) => updateWorkPolicyPreset(...args),
	copySystemWorkPolicyPreset: (...args: unknown[]) => copySystemWorkPolicyPreset(...args),
}));

function renderWithQuery(ui: React.ReactElement) {
	return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe("WorkPolicyPresetReviewDialog", () => {
	it("creates a custom preset from reviewed values", async () => {
		createWorkPolicyPreset.mockResolvedValue({ success: true, data: { id: "preset-1" } });
		const onSuccess = vi.fn();

		renderWithQuery(
			<WorkPolicyPresetReviewDialog open onOpenChange={vi.fn()} organizationId="org-1" mode="createCustom" onSuccess={onSuccess} />,
		);

		await userEvent.type(screen.getByLabelText("Name"), "Retail 38h");
		await userEvent.click(screen.getByRole("button", { name: "Save custom preset" }));

		expect(createWorkPolicyPreset).toHaveBeenCalledWith("org-1", expect.objectContaining({ name: "Retail 38h" }));
		expect(onSuccess).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-import.test.tsx`

Expected: FAIL because `work-policy-preset-review-dialog.tsx` does not exist.

- [ ] **Step 3: Implement the dialog skeleton and submit paths**

Create `apps/webapp/src/components/settings/work-policy-preset-review-dialog.tsx`. Keep fields minimal but complete for schedule/regulation template values; use TanStack Form.

```tsx
"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createWorkPolicyFromPreset, createWorkPolicyPreset, copySystemWorkPolicyPreset, updateWorkPolicyPreset, type WorkPolicyPresetInput, type WorkPolicyPresetWithSource } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { ActionPanel, ActionPanelBody, ActionPanelContent, ActionPanelFooter, ActionPanelHeader, ActionPanelTitle } from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { buildPresetReviewValues } from "./work-policy-preset-utils";

type ReviewMode = "createCustom" | "editCustom" | "copySystem" | "useAsPolicy";

interface WorkPolicyPresetReviewDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	mode: ReviewMode;
	preset?: WorkPolicyPresetWithSource | null;
	onSuccess: () => void;
}

const emptyValues = buildPresetReviewValues();

export function WorkPolicyPresetReviewDialog({ open, onOpenChange, organizationId, mode, preset, onSuccess }: WorkPolicyPresetReviewDialogProps) {
	const { t } = useTranslate();
	const [setAsDefault, setSetAsDefault] = useState(false);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: emptyValues,
		onSubmit: async ({ value }) => mutation.mutate(value),
	});

	useEffect(() => {
		if (open) {
			form.reset();
			const values = buildPresetReviewValues(preset ?? undefined);
			form.setFieldValue("name", mode === "copySystem" && values.name ? `${values.name} Copy` : values.name);
			form.setFieldValue("description", values.description);
			form.setFieldValue("countryCode", values.countryCode);
			form.setFieldValue("scheduleEnabled", values.scheduleEnabled);
			form.setFieldValue("regulationEnabled", values.regulationEnabled);
			form.setFieldValue("schedule", values.schedule);
			form.setFieldValue("regulation", values.regulation);
			setFieldError(null);
		}
	}, [open, preset, mode, form]);

	const mutation = useMutation({
		mutationFn: async (value: WorkPolicyPresetInput) => {
			if (mode === "createCustom") return createWorkPolicyPreset(organizationId, value);
			if (mode === "editCustom") return updateWorkPolicyPreset(organizationId, preset!.id, value);
			if (mode === "copySystem") return copySystemWorkPolicyPreset(organizationId, preset!.id, value);
			return createWorkPolicyFromPreset(organizationId, preset!.id, value, setAsDefault);
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.presetSaved", "Preset saved"));
				onSuccess();
				onOpenChange(false);
				return;
			}
			setFieldError(result.error ?? t("settings.workPolicies.presetSaveFailed", "Failed to save preset"));
		},
		onError: () => setFieldError(t("settings.workPolicies.presetSaveFailed", "Failed to save preset")),
	});

	const submitLabel = mode === "useAsPolicy" ? "Create policy" : mode === "editCustom" ? "Save changes" : "Save custom preset";

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.workPolicies.reviewPreset", "Review preset")}</ActionPanelTitle>
				</ActionPanelHeader>
				<form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); form.handleSubmit(); }}>
					<ActionPanelBody className="space-y-4">
						<form.Field name="name">{(field) => <div className="space-y-2"><Label htmlFor="preset-name">{t("settings.workPolicies.name", "Name")}</Label><Input id="preset-name" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /></div>}</form.Field>
						{fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
						<form.Field name="description">{(field) => <div className="space-y-2"><Label htmlFor="preset-description">{t("settings.workPolicies.descriptionLabel", "Description")}</Label><Textarea id="preset-description" value={field.state.value ?? ""} onChange={(event) => field.handleChange(event.target.value)} /></div>}</form.Field>
						<form.Field name="countryCode">{(field) => <div className="space-y-2"><Label htmlFor="preset-country">{t("settings.workPolicies.country", "Country")}</Label><Input id="preset-country" value={field.state.value ?? ""} onChange={(event) => field.handleChange(event.target.value || null)} /></div>}</form.Field>
						<form.Field name="scheduleEnabled">{(field) => <div className="flex items-center justify-between rounded-md border p-3"><Label>{t("settings.workPolicies.workSchedule", "Work Schedule")}</Label><Switch checked={field.state.value} onCheckedChange={field.handleChange} /></div>}</form.Field>
						<form.Field name="schedule.hoursPerCycle">{(field) => <div className="space-y-2"><Label htmlFor="preset-hours">{t("settings.workPolicies.hoursPerCycle", "Hours per cycle")}</Label><Input id="preset-hours" value={field.state.value ?? ""} onChange={(event) => field.handleChange(event.target.value)} /></div>}</form.Field>
						<form.Field name="regulationEnabled">{(field) => <div className="flex items-center justify-between rounded-md border p-3"><Label>{t("settings.workPolicies.timeRegulation", "Time Regulation")}</Label><Switch checked={field.state.value} onCheckedChange={field.handleChange} /></div>}</form.Field>
						{mode === "useAsPolicy" ? <div className="flex items-center gap-2"><Checkbox id="preset-default" checked={setAsDefault} onCheckedChange={(checked) => setSetAsDefault(Boolean(checked))} /><Label htmlFor="preset-default">{t("settings.workPolicies.setAsDefaultOnImport", "Set as organization default after import")}</Label></div> : null}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel", "Cancel")}</Button>
						<Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}{submitLabel}</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
```

- [ ] **Step 4: Run dialog test**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-import.test.tsx`

Expected: PASS for the create-custom test.

- [ ] **Step 5: Add tests for use-as-policy and duplicate-name display**

Append tests verifying `createWorkPolicyFromPreset` receives reviewed values and server errors render inline.

```tsx
it("creates a policy from reviewed preset values", async () => {
	createWorkPolicyFromPreset.mockResolvedValue({ success: true, data: { id: "policy-1" } });
	const onSuccess = vi.fn();

	renderWithQuery(<WorkPolicyPresetReviewDialog open onOpenChange={vi.fn()} organizationId="org-1" mode="useAsPolicy" preset={{ id: "system-1", organizationId: null, source: "system", name: "System", description: null, countryCode: "DE" } as any} onSuccess={onSuccess} />);

	await userEvent.clear(screen.getByLabelText("Name"));
	await userEvent.type(screen.getByLabelText("Name"), "Reviewed Policy");
	await userEvent.click(screen.getByRole("button", { name: "Create policy" }));

	expect(createWorkPolicyFromPreset).toHaveBeenCalledWith("org-1", "system-1", expect.objectContaining({ name: "Reviewed Policy" }), false);
});

it("shows duplicate-name errors inline", async () => {
	createWorkPolicyPreset.mockResolvedValue({ success: false, error: "A preset with this name already exists", code: "CONFLICT_ERROR" });

	renderWithQuery(<WorkPolicyPresetReviewDialog open onOpenChange={vi.fn()} organizationId="org-1" mode="createCustom" onSuccess={vi.fn()} />);

	await userEvent.type(screen.getByLabelText("Name"), "Retail 38h");
	await userEvent.click(screen.getByRole("button", { name: "Save custom preset" }));

	expect(await screen.findByText("A preset with this name already exists")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run dialog tests**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-import.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/settings/work-policy-preset-review-dialog.tsx apps/webapp/src/components/settings/work-policy-preset-import.test.tsx
git commit -m "feat: add work policy preset review dialog"
```

---

### Task 6: Preset Library UI

**Files:**
- Modify: `apps/webapp/src/components/settings/work-policy-preset-import.tsx`
- Modify: `apps/webapp/src/components/settings/work-policy-management.tsx:83-145`
- Modify: `apps/webapp/src/lib/query/keys.ts:378-385`
- Modify: `apps/webapp/src/components/settings/work-policy-preset-import.test.tsx`

- [ ] **Step 1: Write failing library tests**

Append tests to `work-policy-preset-import.test.tsx` that render `WorkPolicyPresetImport`, verify filtering, and verify system/custom actions.

```tsx
import { WorkPolicyPresetImport } from "./work-policy-preset-import";

const getWorkPolicyPresets = vi.fn();
const archiveWorkPolicyPreset = vi.fn();

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	getWorkPolicyPresets: (...args: unknown[]) => getWorkPolicyPresets(...args),
	archiveWorkPolicyPreset: (...args: unknown[]) => archiveWorkPolicyPreset(...args),
	createWorkPolicyPreset: (...args: unknown[]) => createWorkPolicyPreset(...args),
	createWorkPolicyFromPreset: (...args: unknown[]) => createWorkPolicyFromPreset(...args),
	updateWorkPolicyPreset: (...args: unknown[]) => updateWorkPolicyPreset(...args),
	copySystemWorkPolicyPreset: (...args: unknown[]) => copySystemWorkPolicyPreset(...args),
}));

it("shows system and custom presets with correct actions", async () => {
	getWorkPolicyPresets.mockResolvedValue({ success: true, data: [
		{ id: "system-1", organizationId: null, source: "system", name: "German Labor Law", description: "ArbZG", countryCode: "DE", maxDailyMinutes: 600, maxWeeklyMinutes: 2880, maxUninterruptedMinutes: 360, breakRulesJson: JSON.stringify({ rules: [] }) },
		{ id: "custom-1", organizationId: "org-1", source: "custom", name: "Retail 38h", description: "Store teams", countryCode: "DE", maxDailyMinutes: 480, maxWeeklyMinutes: 2280, maxUninterruptedMinutes: 300, breakRulesJson: JSON.stringify({ rules: [] }) },
	] });

	renderWithQuery(<WorkPolicyPresetImport organizationId="org-1" onImportSuccess={vi.fn()} />);

	expect(await screen.findByText("German Labor Law")).toBeInTheDocument();
	expect(screen.getByText("Retail 38h")).toBeInTheDocument();
	expect(screen.getAllByRole("button", { name: "Use as policy" })).toHaveLength(2);
	expect(screen.getByRole("button", { name: "Copy to custom preset" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Edit preset" })).toBeInTheDocument();
});

it("filters presets by search", async () => {
	getWorkPolicyPresets.mockResolvedValue({ success: true, data: [
		{ id: "system-1", organizationId: null, source: "system", name: "German Labor Law", description: "ArbZG", countryCode: "DE" },
		{ id: "custom-1", organizationId: "org-1", source: "custom", name: "Retail 38h", description: "Store teams", countryCode: "DE" },
	] });

	renderWithQuery(<WorkPolicyPresetImport organizationId="org-1" onImportSuccess={vi.fn()} />);
	await screen.findByText("German Labor Law");
	await userEvent.type(screen.getByPlaceholderText("Search presets..."), "retail");

	expect(screen.queryByText("German Labor Law")).not.toBeInTheDocument();
	expect(screen.getByText("Retail 38h")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-import.test.tsx`

Expected: FAIL because current UI still uses old import-only behavior and query action signature.

- [ ] **Step 3: Update query key**

In `apps/webapp/src/lib/query/keys.ts`, change presets key.

```ts
presets: (orgId: string) => ["work-policies", "presets", orgId] as const,
```

- [ ] **Step 4: Replace the import grid with library UI**

Update `apps/webapp/src/components/settings/work-policy-preset-import.tsx` to use `getWorkPolicyPresets(organizationId)`, utility filtering, and the review dialog. Keep the component export name.

```tsx
const [search, setSearch] = useState("");
const [sourceFilter, setSourceFilter] = useState<PresetSourceFilter>("all");
const [countryFilter, setCountryFilter] = useState("all");
const [reviewState, setReviewState] = useState<{ mode: "createCustom" | "editCustom" | "copySystem" | "useAsPolicy"; preset?: WorkPolicyPresetWithSource | null } | null>(null);

const { data: presets, isLoading, error } = useQuery({
	queryKey: queryKeys.workPolicies.presets(organizationId),
	queryFn: async () => {
		const result = await getWorkPolicyPresets(organizationId);
		if (!result.success) throw new Error(result.error || "Failed to fetch presets");
		return result.data;
	},
	staleTime: 5 * 60 * 1000,
	refetchOnWindowFocus: false,
});

const filteredPresets = filterWorkPolicyPresets(presets ?? [], {
	search,
	source: sourceFilter,
	countryCode: countryFilter,
});
```

Render controls and actions with accessible labels matching tests:

```tsx
<Input placeholder={t("settings.workPolicies.searchPresets", "Search presets...")} value={search} onChange={(event) => setSearch(event.target.value)} />
<Button type="button" onClick={() => setReviewState({ mode: "createCustom" })}>{t("settings.workPolicies.createCustomPreset", "Create custom preset")}</Button>
```

For each preset card:

```tsx
<Badge variant={preset.source === "system" ? "secondary" : "outline"}>{preset.source === "system" ? "System" : "Custom"}</Badge>
<Button type="button" variant="outline" onClick={() => setReviewState({ mode: "useAsPolicy", preset })}>Use as policy</Button>
{preset.source === "system" ? <Button type="button" variant="outline" onClick={() => setReviewState({ mode: "copySystem", preset })}>Copy to custom preset</Button> : null}
{preset.source === "custom" ? <Button type="button" variant="outline" onClick={() => setReviewState({ mode: "editCustom", preset })}>Edit preset</Button> : null}
{preset.source === "custom" ? <Button type="button" variant="ghost" onClick={() => archiveMutation.mutate(preset.id)}>Archive</Button> : null}
```

Render `WorkPolicyPresetReviewDialog` when `reviewState` is set and invalidate both preset and policy lists on success.

```tsx
{reviewState ? (
	<WorkPolicyPresetReviewDialog
		open
		onOpenChange={(open) => !open && setReviewState(null)}
		organizationId={organizationId}
		mode={reviewState.mode}
		preset={reviewState.preset}
		onSuccess={() => {
			queryClient.invalidateQueries({ queryKey: queryKeys.workPolicies.presets(organizationId) });
			queryClient.invalidateQueries({ queryKey: queryKeys.workPolicies.list(organizationId) });
			onImportSuccess();
		}}
	/>
) : null}
```

- [ ] **Step 5: Update management invalidation**

In `work-policy-management.tsx`, invalidate the org-scoped preset query inside `handlePresetImportSuccess`.

```ts
queryClient.invalidateQueries({
	queryKey: queryKeys.workPolicies.presets(organizationId),
});
```

- [ ] **Step 6: Run UI tests**

Run: `pnpm --dir apps/webapp test src/components/settings/work-policy-preset-import.test.tsx src/components/settings/work-policy-preset-utils.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/settings/work-policy-preset-import.tsx apps/webapp/src/components/settings/work-policy-management.tsx apps/webapp/src/lib/query/keys.ts apps/webapp/src/components/settings/work-policy-preset-import.test.tsx
git commit -m "feat: build work policy preset library"
```

---

### Task 7: Documentation And Final Verification

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/work-policies.mdx:113-136`

- [ ] **Step 1: Update admin guide preset section**

Replace the current `## Labor Law Presets` section with text that describes system and custom presets.

```mdx
## Work Policy Presets

Use the **Presets** tab to start from reusable work policy templates.

- **System presets** are Z8-provided defaults based on common labor-law configurations. They are read-only.
- **Custom presets** are owned by your organization. Org admins can create, edit, archive, and reuse them.
- Presets are templates only. They do not affect employees until you use one to create a real work policy.

<Steps>
  <Step>
    Go to **Settings** → **Work Policies** → **Presets**
  </Step>
  <Step>
    Search or filter presets by source or country
  </Step>
  <Step>
    Choose **Use as policy** to review values and create an active work policy
  </Step>
  <Step>
    Choose **Copy to custom preset** to make an editable organization-owned preset from a system preset
  </Step>
  <Step>
    Use a unique name inside your organization before saving
  </Step>
</Steps>
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/work-policies/actions.scope.test.ts src/components/settings/work-policy-preset-utils.test.ts src/components/settings/work-policy-preset-import.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run broader validation**

Run: `pnpm --dir apps/webapp test`

Expected: PASS. If unrelated dirty-worktree failures exist, record them with file/test names and continue only after confirming they are unrelated to this feature.

- [ ] **Step 4: Run production build**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run: `git diff --stat`

Expected: Diff includes only work-policy preset implementation files and docs.

- [ ] **Step 6: Commit**

```bash
git add apps/docs/content/docs/guide/admin-guide/work-policies.mdx
git commit -m "docs: update work policy preset guide"
```

---

## Implementation Notes

- Use `pnpm` only.
- Do not edit `apps/webapp/src/db/auth-schema.ts`.
- Preserve concurrent user changes. Stage only files touched by the current task.
- Keep all preset reads and mutations organization-scoped except system presets, which are visible to all orgs through `organizationId IS NULL`.
- Use `@tanstack/react-form` for the review dialog.
- Use `@tabler/icons-react` for icons.
- Do not derive date/time business behavior in this feature; presets store template values only.

## Final Acceptance Criteria

- System presets remain visible and read-only to org admins.
- Custom presets are visible only in their owning organization.
- Org admins can create, edit, archive, and use custom presets.
- Org admins can copy system presets to custom presets.
- All preset-to-policy flows require an editable review step and enforce unique names.
- Creating or defaulting a real work policy still marks work balances dirty.
- Preset template changes do not mark work balances dirty.
- Focused server and UI tests pass.
- `CI=true pnpm build` passes or any failure is documented as pre-existing and unrelated.
