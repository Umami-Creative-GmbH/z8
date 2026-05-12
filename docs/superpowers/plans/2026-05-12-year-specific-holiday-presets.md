# Year-Specific Holiday Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to import and assign separate holiday presets for current and future years without blocking vacation planning.

**Architecture:** Make imported holiday presets year-aware with a nullable `holiday_preset.year` column and a location-plus-year uniqueness rule. Replace the one-active-assignment-per-target assumption with server-side overlap validation over `effectiveFrom` and `effectiveUntil`, then expose date ranges in import and assignment UI.

**Tech Stack:** Next.js App Router, React, TanStack Form, TanStack Query, Drizzle ORM/PostgreSQL, Vitest, Luxon for dates.

---

## File Map

- Modify: `apps/webapp/src/db/schema/holiday.ts` for `holiday_preset.year` and index changes.
- Create: `apps/webapp/drizzle/0018_year_specific_holiday_presets.sql` for database migration.
- Modify: `apps/webapp/src/lib/holidays/validation.ts` for `year` and assignment date inputs.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.ts` for year-aware CRUD and overlap validation.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts` for server action behavior.
- Modify: `apps/webapp/src/components/settings/holiday-import-dialog.tsx` for year-specific preset naming and date-ranged default assignment.
- Modify: `apps/webapp/src/components/settings/assignment-dialog.tsx` for effective date inputs.
- Modify: `apps/webapp/src/components/settings/assignment-manager.tsx` for range display and multiple org assignments.
- Modify: `apps/webapp/src/components/settings/preset-manager.tsx` for year display.
- Modify: `apps/webapp/src/components/settings/preset-dialog.tsx` for year display/edit preservation.
- Create: `apps/webapp/src/components/settings/holiday-import-dialog.test.tsx` if no nearby coverage exists after implementation; otherwise extend an existing settings holiday test.
- Modify: `apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx` for admin documentation.

## Task 1: Add Year To Holiday Presets

**Files:**
- Modify: `apps/webapp/src/db/schema/holiday.ts`
- Create: `apps/webapp/drizzle/0018_year_specific_holiday_presets.sql`
- Modify: `apps/webapp/src/lib/holidays/validation.ts`

- [ ] **Step 1: Update the Drizzle schema**

In `apps/webapp/src/db/schema/holiday.ts`, add `year` after `regionCode` in `holidayPreset`:

```ts
year: integer("year"), // Import year for year-specific presets, e.g. 2027
```

Replace the existing location unique index:

```ts
uniqueIndex("holidayPreset_org_location_idx").on(
	table.organizationId,
	table.countryCode,
	table.stateCode,
	table.regionCode,
),
```

with:

```ts
uniqueIndex("holidayPreset_org_location_year_idx").on(
	table.organizationId,
	table.countryCode,
	table.stateCode,
	table.regionCode,
	table.year,
),
```

Remove these assignment unique indexes from `holidayPresetAssignment` because overlap validation will replace them:

```ts
uniqueIndex("holidayPresetAssignment_org_default_idx")
	.on(table.organizationId, table.assignmentType)
	.where(sql`assignment_type = 'organization' AND is_active = true`),
uniqueIndex("holidayPresetAssignment_team_idx")
	.on(table.teamId)
	.where(sql`team_id IS NOT NULL AND is_active = true`),
uniqueIndex("holidayPresetAssignment_employee_idx")
	.on(table.employeeId)
	.where(sql`employee_id IS NOT NULL AND is_active = true`),
```

Keep the non-unique indexes for `organizationId`, `teamId`, and `employeeId`.

- [ ] **Step 2: Add the migration SQL**

Create `apps/webapp/drizzle/0018_year_specific_holiday_presets.sql`:

```sql
ALTER TABLE "holiday_preset" ADD COLUMN "year" integer;--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPreset_org_location_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPreset_org_location_year_idx" ON "holiday_preset" USING btree ("organization_id","country_code","state_code","region_code","year");--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPresetAssignment_org_default_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPresetAssignment_team_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPresetAssignment_employee_idx";
```

- [ ] **Step 3: Extend validation schema**

In `apps/webapp/src/lib/holidays/validation.ts`, update `holidayPresetFormSchema`:

```ts
year: z.number().min(2000).max(2100).optional().nullable(),
```

Place it after `regionCode`.

- [ ] **Step 4: Run schema-related tests**

Run:

```bash
pnpm --filter @z8/webapp test -- src/db/schema
```

Expected: PASS, or no matching tests if this package filter does not match schema-only tests.

- [ ] **Step 5: Commit checkpoint only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested, run:

```bash
git add apps/webapp/src/db/schema/holiday.ts apps/webapp/drizzle/0018_year_specific_holiday_presets.sql apps/webapp/src/lib/holidays/validation.ts
git commit -m "feat: make holiday presets year-aware"
```

## Task 2: Make Preset Actions Year-Aware

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts`

- [ ] **Step 1: Write failing tests for location-plus-year and assignment ranges**

Create `apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts` with focused unit-style tests around helper functions. If helpers are not exported yet, add them in Step 3.

```ts
import { describe, expect, it } from "vitest";
import { assignmentRangesOverlap, buildPresetLocationConflictConditions } from "./preset-actions";

describe("holiday preset scheduling behavior", () => {
	it("treats adjacent calendar-year assignment ranges as non-overlapping", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				new Date("2026-12-31T23:59:59.999Z"),
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-12-31T23:59:59.999Z"),
			),
		).toBe(false);
	});

	it("treats overlapping assignment ranges as overlapping", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				new Date("2026-12-31T23:59:59.999Z"),
				new Date("2026-06-01T00:00:00.000Z"),
				new Date("2027-05-31T23:59:59.999Z"),
			),
		).toBe(true);
	});

	it("treats open-ended ranges as unbounded", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				null,
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-12-31T23:59:59.999Z"),
			),
		).toBe(true);
	});

	it("includes year in imported preset location conflict checks", () => {
		const conditions = buildPresetLocationConflictConditions("org-1", {
			countryCode: "DE",
			stateCode: "BY",
			regionCode: undefined,
			year: 2027,
		});

		expect(conditions).toHaveLength(5);
	});
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
pnpm --filter @z8/webapp test -- 'src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts'
```

Expected: FAIL because `assignmentRangesOverlap` and `buildPresetLocationConflictConditions` are not exported.

- [ ] **Step 3: Add helper functions**

In `apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.ts`, add imports if missing:

```ts
import { and, eq, gte, isNull, lte, or, type SQL, sql } from "drizzle-orm";
```

Replace the current import line if it lacks `gte`, `lte`, or `or`.

Add these helpers near `filterPresetAssignmentsForScope`:

```ts
type PresetLocationConflictInput = {
	countryCode?: string | null;
	stateCode?: string | null;
	regionCode?: string | null;
	year?: number | null;
};

export function assignmentRangesOverlap(
	leftFrom: Date | null | undefined,
	leftUntil: Date | null | undefined,
	rightFrom: Date | null | undefined,
	rightUntil: Date | null | undefined,
) {
	const minTime = Number.NEGATIVE_INFINITY;
	const maxTime = Number.POSITIVE_INFINITY;
	const leftStart = leftFrom?.getTime() ?? minTime;
	const leftEnd = leftUntil?.getTime() ?? maxTime;
	const rightStart = rightFrom?.getTime() ?? minTime;
	const rightEnd = rightUntil?.getTime() ?? maxTime;

	return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function buildPresetLocationConflictConditions(
	organizationId: string,
	data: PresetLocationConflictInput,
): SQL[] {
	const conditions: SQL[] = [eq(holidayPreset.organizationId, organizationId)];

	if (data.countryCode) {
		conditions.push(eq(holidayPreset.countryCode, data.countryCode));
	} else {
		conditions.push(isNull(holidayPreset.countryCode));
	}

	if (data.stateCode) {
		conditions.push(eq(holidayPreset.stateCode, data.stateCode));
	} else {
		conditions.push(isNull(holidayPreset.stateCode));
	}

	if (data.regionCode) {
		conditions.push(eq(holidayPreset.regionCode, data.regionCode));
	} else {
		conditions.push(isNull(holidayPreset.regionCode));
	}

	if (data.year) {
		conditions.push(eq(holidayPreset.year, data.year));
	} else {
		conditions.push(isNull(holidayPreset.year));
	}

	return conditions;
}
```

- [ ] **Step 4: Thread `year` through preset list/detail/create/update**

Update `HolidayPresetListItem` in `preset-actions.ts`:

```ts
year: number | null;
```

Add `year: holidayPreset.year` to `getHolidayPresets` select.

In `createHolidayPreset`, replace the existing location conflict block with:

```ts
const existingConditions = buildPresetLocationConflictConditions(organizationId, data);

const existing = yield* _(
	actor.dbService.query("checkExisting", async () => {
		const [p] = await actor.dbService.db
			.select()
			.from(holidayPreset)
			.where(and(...existingConditions))
			.limit(1);
		return p;
	}),
);

if (existing) {
	yield* _(
		Effect.fail(
			new ConflictError({
				message: data.year
					? "A preset for this location and year already exists"
					: "A preset for this location already exists",
				conflictType: "duplicate_location",
				details: { existingId: existing.id, year: data.year ?? null },
			}),
		),
	);
}
```

Add `year: data.year || null` to `insert(holidayPreset).values(...)`.

Add `year: data.year || null` to `updateHolidayPreset` values.

- [ ] **Step 5: Add overlap validation to `createPresetAssignment`**

In `createPresetAssignment`, replace the current `existingConditions` and `checkExisting` block with target-specific range overlap validation:

```ts
const targetConditions: SQL[] = [
	eq(holidayPresetAssignment.organizationId, organizationId),
	eq(holidayPresetAssignment.assignmentType, data.assignmentType),
	eq(holidayPresetAssignment.isActive, true),
];

if (data.assignmentType === "team" && data.teamId) {
	targetConditions.push(eq(holidayPresetAssignment.teamId, data.teamId));
} else if (data.assignmentType === "employee" && data.employeeId) {
	targetConditions.push(eq(holidayPresetAssignment.employeeId, data.employeeId));
}

const existingAssignments = yield* _(
	actor.dbService.query("checkExistingRange", async () => {
		return await actor.dbService.db
			.select()
			.from(holidayPresetAssignment)
			.where(and(...targetConditions));
	}),
);

const overlappingAssignment = existingAssignments.find((assignment) =>
	assignmentRangesOverlap(
		assignment.effectiveFrom,
		assignment.effectiveUntil,
		data.effectiveFrom,
		data.effectiveUntil,
	),
);

if (overlappingAssignment) {
	yield* _(
		Effect.fail(
			new ConflictError({
				message: "An assignment already exists for this target in the selected date range",
				conflictType: "duplicate_assignment_range",
				details: { existingId: overlappingAssignment.id },
			}),
		),
	);
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @z8/webapp test -- 'src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts'
git commit -m "fix: allow scheduled holiday preset assignments"
```

## Task 3: Update Import Flow For Year-Specific Presets

**Files:**
- Modify: `apps/webapp/src/components/settings/holiday-import-dialog.tsx`

- [ ] **Step 1: Add year-specific helper functions near `HOLIDAY_TYPES`**

```ts
function getPresetNameWithYear(baseName: string, year: number) {
	const trimmedName = baseName.trim();
	return trimmedName.endsWith(year.toString()) ? trimmedName : `${trimmedName} ${year}`;
}

function getYearAssignmentRange(year: number) {
	return {
		effectiveFrom: new Date(Date.UTC(year, 0, 1)),
		effectiveUntil: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
	};
}
```

- [ ] **Step 2: Use year-specific names after preview**

In `loadPreview`, replace:

```ts
setPresetName(nameParts.join(" - "));
```

with:

```ts
setPresetName(getPresetNameWithYear(nameParts.join(" - "), selectedYear));
```

- [ ] **Step 3: Save `year` on preset creation**

In `handleImport`, update `createHolidayPreset` data:

```ts
year: selectedYear,
```

Place it after `regionCode`.

- [ ] **Step 4: Assign imported defaults only for the selected year**

In `handleImport`, before building `parallelOperations`, add:

```ts
const assignmentRange = getYearAssignmentRange(selectedYear);
```

Update the `createPresetAssignment` call:

```ts
createPresetAssignment(organizationId, {
	presetId,
	assignmentType: "organization",
	effectiveFrom: assignmentRange.effectiveFrom,
	effectiveUntil: assignmentRange.effectiveUntil,
	isActive: true,
}),
```

- [ ] **Step 5: Run targeted typecheck or test**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/settings/holiday-dialog.test.tsx
```

Expected: PASS. This is nearby coverage; if it does not exercise the import dialog, continue to Task 7 for full checks.

- [ ] **Step 6: Commit checkpoint only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested, run:

```bash
git add apps/webapp/src/components/settings/holiday-import-dialog.tsx
git commit -m "feat: import holiday presets by year"
```

## Task 4: Add Effective Date Inputs To Assignment Dialog

**Files:**
- Modify: `apps/webapp/src/components/settings/assignment-dialog.tsx`

- [ ] **Step 1: Add helper functions below interfaces**

```ts
function formatDateInputValue(date: Date) {
	return date.toISOString().slice(0, 10);
}

function parseDateInputValue(value: string) {
	return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function getDefaultAssignmentDates() {
	const year = new Date().getFullYear();
	return {
		effectiveFrom: formatDateInputValue(new Date(Date.UTC(year, 0, 1))),
		effectiveUntil: formatDateInputValue(new Date(Date.UTC(year, 11, 31))),
	};
}
```

- [ ] **Step 2: Extend form defaults**

Before `useForm`, add:

```ts
const defaultAssignmentDates = getDefaultAssignmentDates();
```

Update `defaultValues`:

```ts
effectiveFrom: defaultAssignmentDates.effectiveFrom,
effectiveUntil: defaultAssignmentDates.effectiveUntil,
```

- [ ] **Step 3: Validate dates in `onSubmit`**

Inside `onSubmit`, after target validation, add:

```ts
if (value.effectiveFrom && value.effectiveUntil && value.effectiveUntil < value.effectiveFrom) {
	errors.effectiveUntil = "End date must be after start date";
}
```

- [ ] **Step 4: Send dates to server action**

Update the mutation function type:

```ts
mutationFn: (values: {
	presetId: string;
	teamId: string;
	employeeId: string;
	effectiveFrom: string;
	effectiveUntil: string;
}) =>
	createPresetAssignment(organizationId, {
		presetId: values.presetId,
		assignmentType,
		teamId: assignmentType === "team" ? values.teamId : undefined,
		employeeId: assignmentType === "employee" ? values.employeeId : undefined,
		effectiveFrom: parseDateInputValue(values.effectiveFrom),
		effectiveUntil: values.effectiveUntil
			? new Date(`${values.effectiveUntil}T23:59:59.999Z`)
			: null,
		isActive: true,
	}),
```

- [ ] **Step 5: Render date inputs**

After the preset selection field and before target selection, add:

```tsx
<div className="grid gap-4 sm:grid-cols-2">
	<form.Field name="effectiveFrom">
		{(field) => (
			<div className="space-y-2">
				<Label>{t("settings.holidays.assignments.effectiveFrom", "Effective from")}</Label>
				<input
					type="date"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				/>
			</div>
		)}
	</form.Field>
	<form.Field name="effectiveUntil">
		{(field) => (
			<div className="space-y-2">
				<Label>{t("settings.holidays.assignments.effectiveUntil", "Effective until")}</Label>
				<input
					type="date"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				/>
				{validationErrors.effectiveUntil && (
					<p className="text-sm text-destructive">{validationErrors.effectiveUntil}</p>
				)}
			</div>
		)}
	</form.Field>
</div>
```

- [ ] **Step 6: Run targeted test command**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/settings/holiday-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested, run:

```bash
git add apps/webapp/src/components/settings/assignment-dialog.tsx
git commit -m "feat: schedule holiday preset assignments"
```

## Task 5: Display Years And Assignment Ranges

**Files:**
- Modify: `apps/webapp/src/components/settings/assignment-manager.tsx`
- Modify: `apps/webapp/src/components/settings/preset-manager.tsx`
- Modify: `apps/webapp/src/components/settings/preset-dialog.tsx`

- [ ] **Step 1: Add `year` to preset types**

In `assignment-manager.tsx`, add to `PresetAssignmentData.preset`:

```ts
year: number | null;
```

In `preset-manager.tsx`, add to `PresetData`:

```ts
year: number | null;
```

In `preset-dialog.tsx`, include `year` in form defaults if editable:

```ts
year: null as number | null,
```

- [ ] **Step 2: Show year badge in preset cards**

In `preset-manager.tsx`, after the preset title line, add:

```tsx
{preset.year && (
	<Badge variant="outline" className="mt-2">
		{preset.year}
	</Badge>
)}
```

- [ ] **Step 3: Add date formatting helper to assignment manager**

In `assignment-manager.tsx`, near `isDeleting`, add:

```ts
function formatAssignmentRange(effectiveFrom: Date | null, effectiveUntil: Date | null) {
	if (!effectiveFrom && !effectiveUntil) return t("settings.holidays.assignments.always", "Always");
	const from = effectiveFrom ? effectiveFrom.toLocaleDateString() : t("common.start", "Start");
	const until = effectiveUntil ? effectiveUntil.toLocaleDateString() : t("common.openEnded", "Open ended");
	return `${from} - ${until}`;
}
```

- [ ] **Step 4: Stop assuming one organization assignment**

In `assignment-manager.tsx`, replace:

```ts
const orgPresetAssignment = presets.find((a) => a.assignmentType === "organization");
```

with:

```ts
const orgPresetAssignments = presets.filter((a) => a.assignmentType === "organization");
```

Then update the organization assignment rendering to map `orgPresetAssignments` instead of rendering one item. Each rendered item should include:

```tsx
<p className="text-sm text-muted-foreground">
	{formatAssignmentRange(assignment.effectiveFrom, assignment.effectiveUntil)}
</p>
```

Use the same paragraph in team and employee assignment rows.

- [ ] **Step 5: Add read-only year display in preset dialog**

In `preset-dialog.tsx`, after the location info block, add:

```tsx
{data?.preset?.year && (
	<div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
		<IconCalendar className="h-4 w-4" />
		<span>{t("settings.holidays.presets.year", "Year")}: {data.preset.year}</span>
	</div>
)}
```

- [ ] **Step 6: Run targeted test command**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/settings/holiday-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested, run:

```bash
git add apps/webapp/src/components/settings/assignment-manager.tsx apps/webapp/src/components/settings/preset-manager.tsx apps/webapp/src/components/settings/preset-dialog.tsx
git commit -m "feat: show holiday preset schedules"
```

## Task 6: Update Admin Documentation

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx`

- [ ] **Step 1: Update country-based template instructions**

Replace lines 19-30 with:

```mdx
### Country-Based Templates

Import holidays based on country and year:

1. Go to **Settings** -> **Holidays**
2. Click **"Import Holidays"**
3. Select the **country** and optional region from the dropdowns
4. Choose the **year** to import
5. Review the list of holidays
6. Click **"Import Selected"**

Imported presets are year-specific. For example, import `Germany - Bavaria 2026` for the current year and `Germany - Bavaria 2027` for next year. Assign each preset to the organization, team, or employee with the matching effective date range so employees can plan future vacations.
```

- [ ] **Step 2: Add scheduling note under managing holiday presets**

After the “Assign Preset to Location” list, add:

```mdx
**Schedule Next Year's Holidays:**
1. Import the next year's holiday preset for the same country or region
2. Assign it to the same organization, team, or employee
3. Set **Effective from** to January 1 of that year
4. Set **Effective until** to December 31 of that year

Assignments for different years can coexist as long as their effective date ranges do not overlap.
```

- [ ] **Step 3: Commit checkpoint only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested, run:

```bash
git add apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx
git commit -m "docs: explain year-specific holiday presets"
```

## Task 7: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run focused holiday tests**

Run:

```bash
pnpm --filter @z8/webapp test -- 'src/app/[locale]/(app)/settings/holidays' src/components/settings/holiday-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader test suite if time allows**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run production build if environment permits**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. If this needs unavailable system-level environment variables, skip it and report exactly which variables blocked it.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff -- apps/webapp/src/db/schema/holiday.ts apps/webapp/drizzle/0018_year_specific_holiday_presets.sql apps/webapp/src/lib/holidays/validation.ts 'apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts' apps/webapp/src/components/settings/holiday-import-dialog.tsx apps/webapp/src/components/settings/assignment-dialog.tsx apps/webapp/src/components/settings/assignment-manager.tsx apps/webapp/src/components/settings/preset-manager.tsx apps/webapp/src/components/settings/preset-dialog.tsx apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx
```

Expected: Diff only contains year-specific holiday preset changes.

- [ ] **Step 5: Final commit only if requested**

Do not commit unless the user explicitly requested commits. If commits were requested and no prior task commits were made, run:

```bash
git add apps/webapp/src/db/schema/holiday.ts apps/webapp/drizzle/0018_year_specific_holiday_presets.sql apps/webapp/src/lib/holidays/validation.ts 'apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/holidays/preset-actions.behavior.test.ts' apps/webapp/src/components/settings/holiday-import-dialog.tsx apps/webapp/src/components/settings/assignment-dialog.tsx apps/webapp/src/components/settings/assignment-manager.tsx apps/webapp/src/components/settings/preset-manager.tsx apps/webapp/src/components/settings/preset-dialog.tsx apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx
git commit -m "feat: support year-specific holiday presets"
```

## Self-Review

Spec coverage:

- Year-specific preset imports: Task 1 and Task 3.
- Same target with non-overlapping yearly assignments: Task 1, Task 2, and Task 4.
- Deterministic holiday resolution: Task 2 preserves existing priority and only changes assignment validity.
- Organization scoping and org-admin mutation access: Task 2 modifies existing org-admin-only server actions without expanding permissions.
- UI range visibility: Task 5.
- Admin documentation: Task 6.

Placeholder scan: no unresolved placeholders or unspecified implementation sections remain.

Type consistency: `year`, `effectiveFrom`, and `effectiveUntil` are introduced in schema, validation, actions, and UI types with the same names.
