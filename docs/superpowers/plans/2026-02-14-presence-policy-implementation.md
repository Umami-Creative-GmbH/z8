# Presence Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to configure how many days per week employees must be physically present at a location, with compliance detection and enforcement.

**Architecture:** Extend the existing `workPolicy` system with a `presenceEnabled` toggle and a new `workPolicyPresence` table (1:1). Add `workLocationType` to `workPeriod` for manual clock-in tagging. Add a `PresenceRequirementRule` to the compliance rules engine for nightly detection. Reuse the existing hierarchical assignment infrastructure.

**Tech Stack:** Drizzle ORM (PostgreSQL), Effect-TS services, Next.js server actions, TanStack Form + React, BullMQ jobs, Vitest, next-intl (Tolgee)

**Design doc:** `docs/plans/2026-02-14-presence-policy-design.md`

---

### Task 1: Add new enums to schema

**Files:**
- Modify: `apps/webapp/src/db/schema/enums.ts`

**Step 1: Add the four new enums**

Add after `restPeriodEnforcementEnum` (around line 157) in `enums.ts`:

```typescript
// Presence policy enums
export const workLocationTypeEnum = pgEnum("work_location_type", [
	"office",
	"home",
	"field",
	"other",
]);

export const presenceModeEnum = pgEnum("presence_mode", [
	"minimum_count",
	"fixed_days",
]);

export const presenceEnforcementEnum = pgEnum("presence_enforcement", [
	"block",
	"warn",
	"none",
]);

export const presenceEvaluationPeriodEnum = pgEnum("presence_evaluation_period", [
	"weekly",
	"biweekly",
	"monthly",
]);
```

**Step 2: Add `presence_requirement` to `complianceFindingTypeEnum`**

In the same file, find `complianceFindingTypeEnum` (line 294) and add `"presence_requirement"` to the array:

```typescript
export const complianceFindingTypeEnum = pgEnum("compliance_finding_type", [
	"rest_period_insufficient",
	"max_hours_daily_exceeded",
	"max_hours_weekly_exceeded",
	"consecutive_days_exceeded",
	"presence_requirement",  // NEW
]);
```

**Step 3: Commit**

```bash
git add apps/webapp/src/db/schema/enums.ts
git commit -m "feat(presence): add work location, presence mode, enforcement, and evaluation period enums"
```

---

### Task 2: Add `presenceEnabled` column to `workPolicy` table

**Files:**
- Modify: `apps/webapp/src/db/schema/work-policy.ts`

**Step 1: Add column to workPolicy table**

In `work-policy.ts`, add after `regulationEnabled` (line 52):

```typescript
presenceEnabled: boolean("presence_enabled").default(false).notNull(),
```

**Step 2: Commit**

```bash
git add apps/webapp/src/db/schema/work-policy.ts
git commit -m "feat(presence): add presenceEnabled toggle to workPolicy table"
```

---

### Task 3: Create `workPolicyPresence` table

**Files:**
- Modify: `apps/webapp/src/db/schema/work-policy.ts`

**Step 1: Add imports for new enums**

At the top of `work-policy.ts`, add to the enums import (line 18-25):

```typescript
import {
	// ... existing imports
	presenceEnforcementEnum,
	presenceEvaluationPeriodEnum,
	presenceModeEnum,
} from "./enums";
import { location } from "./organization";
```

**Step 2: Add the table after `workPolicyScheduleDay` (after line 143)**

```typescript
// ============================================
// PRESENCE CONFIGURATION (1:1 with workPolicy)
// ============================================

/**
 * Presence configuration - defines on-site requirements.
 * Only used when policy.presenceEnabled = true.
 */
export const workPolicyPresence = pgTable(
	"work_policy_presence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.unique()
			.references(() => workPolicy.id, { onDelete: "cascade" }),

		// Mode: minimum count of days or fixed specific days
		presenceMode: presenceModeEnum("presence_mode").default("minimum_count").notNull(),

		// For minimum_count mode: minimum on-site days per evaluation period
		requiredOnsiteDays: integer("required_onsite_days"),

		// For fixed_days mode: JSON array of day_of_week values, e.g. ["monday","wednesday","friday"]
		requiredOnsiteFixedDays: text("required_onsite_fixed_days"),

		// Optional: restrict to a specific location (null = any on-site location)
		locationId: uuid("location_id").references(() => location.id, {
			onDelete: "set null",
		}),

		// How often to evaluate compliance
		evaluationPeriod: presenceEvaluationPeriodEnum("evaluation_period").default("weekly").notNull(),

		// Enforcement level
		enforcement: presenceEnforcementEnum("enforcement").default("warn").notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPolicyPresence_policyId_idx").on(table.policyId),
		index("workPolicyPresence_locationId_idx").on(table.locationId),
	],
);
```

**Step 3: Commit**

```bash
git add apps/webapp/src/db/schema/work-policy.ts
git commit -m "feat(presence): add workPolicyPresence table for on-site requirements"
```

---

### Task 4: Add `workLocationType` column to `workPeriod` table

**Files:**
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`

**Step 1: Import the enum**

At the top of `time-tracking.ts`, add to enum imports (line 6):

```typescript
import { approvalStatusEnum, timeEntryTypeEnum, workLocationTypeEnum } from "./enums";
```

**Step 2: Add column to workPeriod**

In the `workPeriod` table, add after `workCategoryId` (around line 99):

```typescript
// Work location type - employee tags at clock-in (office, home, field, other)
workLocationType: workLocationTypeEnum("work_location_type"),
```

**Step 3: Commit**

```bash
git add apps/webapp/src/db/schema/time-tracking.ts
git commit -m "feat(presence): add workLocationType column to workPeriod for clock-in tagging"
```

---

### Task 5: Add presence evidence type and update compliance finding union

**Files:**
- Modify: `apps/webapp/src/db/schema/compliance-finding.ts`

**Step 1: Add the evidence type**

After `ConsecutiveDaysExceededEvidence` (line 54), add:

```typescript
export type PresenceRequirementEvidence = {
	type: "presence_requirement";
	mode: "minimum_count" | "fixed_days";
	evaluationStart: string; // ISO date
	evaluationEnd: string; // ISO date
	requiredDays: number;
	actualOnsiteDays: number;
	// For fixed_days mode: which required days were missed
	missedDays?: string[]; // day_of_week values, e.g. ["monday", "wednesday"]
	// Days excluded from evaluation (sick, vacation, holiday)
	excludedDays: string[]; // ISO dates
	excludedReasons: string[]; // "sick", "vacation", "holiday", etc.
	// Work periods that counted as on-site
	onsiteWorkPeriodIds: string[];
	// Location constraint (null = any)
	locationId: string | null;
	locationName: string | null;
};
```

**Step 2: Add to the union type**

Update `ComplianceFindingEvidence` (line 56-60):

```typescript
export type ComplianceFindingEvidence =
	| RestPeriodInsufficientEvidence
	| MaxHoursDailyExceededEvidence
	| MaxHoursWeeklyExceededEvidence
	| ConsecutiveDaysExceededEvidence
	| PresenceRequirementEvidence;
```

**Step 3: Commit**

```bash
git add apps/webapp/src/db/schema/compliance-finding.ts
git commit -m "feat(presence): add PresenceRequirementEvidence type to compliance findings"
```

---

### Task 6: Add Drizzle relations for `workPolicyPresence`

**Files:**
- Modify: `apps/webapp/src/db/schema/relations.ts`

**Step 1: Import workPolicyPresence**

Find the work-policy imports in `relations.ts` and add `workPolicyPresence`:

```typescript
import {
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyPresence,  // NEW
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyViolation,
} from "./work-policy";
```

Also import `location` if not already imported.

**Step 2: Add presence to workPolicyRelations**

In `workPolicyRelations` (line 1246), add alongside `schedule` and `regulation`:

```typescript
presence: one(workPolicyPresence),
```

**Step 3: Add the new relation definition**

After `workPolicyScheduleDayRelations` (after line 1280), add:

```typescript
export const workPolicyPresenceRelations = relations(workPolicyPresence, ({ one }) => ({
	policy: one(workPolicy, {
		fields: [workPolicyPresence.policyId],
		references: [workPolicy.id],
	}),
	location: one(location, {
		fields: [workPolicyPresence.locationId],
		references: [location.id],
	}),
}));
```

**Step 4: Commit**

```bash
git add apps/webapp/src/db/schema/relations.ts
git commit -m "feat(presence): add Drizzle relations for workPolicyPresence"
```

---

### Task 7: Export new table from schema index

**Files:**
- Modify: `apps/webapp/src/db/schema/index.ts`

**Step 1: Verify export**

The `index.ts` already has `export * from "./work-policy"`. Since `workPolicyPresence` is defined in `work-policy.ts`, it's automatically exported. Verify this is the case by checking the file. No changes needed unless the export is missing.

**Step 2: Commit (skip if no changes)**

---

### Task 8: Generate and review the database migration

**Files:**
- Create: `apps/webapp/drizzle/0006_presence_policy.sql` (name generated by drizzle-kit)

**Step 1: Generate migration**

```bash
cd apps/webapp
npx drizzle-kit generate --name presence_policy
```

**Step 2: Review the generated SQL**

The migration should contain:
- `CREATE TYPE work_location_type AS ENUM ('office', 'home', 'field', 'other')`
- `CREATE TYPE presence_mode AS ENUM ('minimum_count', 'fixed_days')`
- `CREATE TYPE presence_enforcement AS ENUM ('block', 'warn', 'none')`
- `CREATE TYPE presence_evaluation_period AS ENUM ('weekly', 'biweekly', 'monthly')`
- `ALTER TYPE compliance_finding_type ADD VALUE 'presence_requirement'`
- `ALTER TABLE work_policy ADD COLUMN presence_enabled boolean NOT NULL DEFAULT false`
- `ALTER TABLE work_period ADD COLUMN work_location_type work_location_type`
- `CREATE TABLE work_policy_presence (...)` with indexes

Verify the SQL looks correct. If drizzle-kit generates anything unexpected, adjust the schema and regenerate.

**Step 3: Commit**

```bash
git add apps/webapp/drizzle/
git commit -m "feat(presence): add database migration for presence policy schema"
```

---

### Task 9: Write failing tests for presence counting logic

**Files:**
- Create: `apps/webapp/src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts`

**Step 1: Create the test file**

```typescript
import { DateTime } from "luxon";
import { describe, expect, test } from "vitest";
import type { PresenceRequirementEvidence } from "@/db/schema/compliance-finding";
import { PresenceRequirementRule } from "../presence-requirement-rule";
import type { PresenceRuleDetectionInput, WorkPeriodWithLocation } from "../presence-requirement-rule";

const TIMEZONE = "Europe/Berlin";

function makeWorkPeriod(overrides: Partial<WorkPeriodWithLocation> & { startTime: Date }): WorkPeriodWithLocation {
	return {
		id: crypto.randomUUID(),
		employeeId: "emp-1",
		startTime: overrides.startTime,
		endTime: overrides.endTime ?? new Date(overrides.startTime.getTime() + 8 * 60 * 60_000),
		durationMinutes: overrides.durationMinutes ?? 480,
		isActive: false,
		workLocationType: overrides.workLocationType ?? "office",
	};
}

function makeEmployee() {
	return {
		id: "emp-1",
		organizationId: "org-1",
		firstName: "Test",
		lastName: "User",
		timezone: TIMEZONE,
		policy: {
			policyId: "policy-1",
			policyName: "Default Policy",
			maxDailyMinutes: null,
			maxWeeklyMinutes: null,
			minRestPeriodMinutes: null,
			maxConsecutiveDays: null,
		},
	};
}

describe("PresenceRequirementRule", () => {
	const rule = new PresenceRequirementRule();

	describe("minimum_count mode", () => {
		test("no violation when on-site days meet requirement", async () => {
			// Mon-Wed on-site (3 days), Thu-Fri home = meets 3-day requirement
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE }); // Monday
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 1 }).toJSDate(), workLocationType: "office" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "office" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "home" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(0);
		});

		test("violation when on-site days are below requirement", async () => {
			// Only Mon on-site (1 day), Tue-Fri home = fails 3-day requirement
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 1 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "home" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(1);
			expect(findings[0].type).toBe("presence_requirement");

			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.requiredDays).toBe(3);
			expect(evidence.actualOnsiteDays).toBe(1);
			expect(evidence.mode).toBe("minimum_count");
		});

		test("denominator adjusts for sick days", async () => {
			// Mon on-site, Tue sick, Wed-Fri home
			// Adjusted: 4 available days, need 3. Only 1 on-site = violation
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }),
				// Tuesday is sick - no work period
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "home" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [{ date: "2026-02-10", reason: "sick" }],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.excludedDays).toContain("2026-02-10");
			expect(evidence.excludedReasons).toContain("sick");
		});

		test("no violation when requirement adjusted below available days", async () => {
			// 3-day requirement, but 3 sick days = only 2 available days
			// Requirement is capped to available days: need min(3, 2) = 2
			// Mon on-site, Fri on-site = 2 on-site out of 2 available = pass
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "office" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [
					{ date: "2026-02-10", reason: "sick" },
					{ date: "2026-02-11", reason: "sick" },
					{ date: "2026-02-12", reason: "sick" },
				],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(0);
		});

		test("field location counts as on-site", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "field" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 1 }).toJSDate(), workLocationType: "field" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "field" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "home" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(0);
		});

		test("untagged work periods do not count as on-site", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: null }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 1 }).toJSDate(), workLocationType: null }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: null }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: null }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: null }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.actualOnsiteDays).toBe(0);
		});

		test("multiple work periods on same day count as one on-site day", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			// 3 work periods on Monday, all office
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.set({ hour: 8 }).toJSDate(), workLocationType: "office", durationMinutes: 120 }),
				makeWorkPeriod({ startTime: weekStart.set({ hour: 11 }).toJSDate(), workLocationType: "office", durationMinutes: 120 }),
				makeWorkPeriod({ startTime: weekStart.set({ hour: 14 }).toJSDate(), workLocationType: "office", durationMinutes: 120 }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 1 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "home" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.actualOnsiteDays).toBe(1); // Only 1 day, not 3
		});
	});

	describe("fixed_days mode", () => {
		test("no violation when all fixed days are on-site", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }), // Mon
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "office" }), // Wed
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "office" }), // Fri
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "fixed_days",
					requiredOnsiteDays: null,
					requiredOnsiteFixedDays: ["monday", "wednesday", "friday"],
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(0);
		});

		test("violation when a fixed day is missed", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }), // Mon
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "home" }), // Wed - home instead of office
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "office" }), // Fri
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "fixed_days",
					requiredOnsiteDays: null,
					requiredOnsiteFixedDays: ["monday", "wednesday", "friday"],
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.missedDays).toContain("wednesday");
		});

		test("fixed day is excused when it falls on a holiday", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "office" }), // Mon
				// Wed is a holiday - no work
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "office" }), // Fri
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "fixed_days",
					requiredOnsiteDays: null,
					requiredOnsiteFixedDays: ["monday", "wednesday", "friday"],
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [{ date: "2026-02-11" }], // Wednesday is a holiday
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(0);
		});
	});

	describe("severity calculation", () => {
		test("critical when 0 of 3 required days met", async () => {
			const weekStart = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod({ startTime: weekStart.toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 1 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 2 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 3 }).toJSDate(), workLocationType: "home" }),
				makeWorkPeriod({ startTime: weekStart.plus({ days: 4 }).toJSDate(), workLocationType: "home" }),
			];

			const input: PresenceRuleDetectionInput = {
				employee: makeEmployee(),
				workPeriods,
				dateRange: { start: weekStart, end: weekStart.endOf("week") },
				thresholdOverrides: null,
				presenceConfig: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: null,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
				absenceDays: [],
				holidayDays: [],
			};

			const findings = await rule.detectViolations(input);
			expect(findings).toHaveLength(1);
			expect(findings[0].severity).toBe("critical");
		});
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/webapp
npx vitest run src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts
```

Expected: FAIL - cannot resolve `../presence-requirement-rule`.

**Step 3: Commit**

```bash
git add apps/webapp/src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts
git commit -m "test(presence): add failing tests for PresenceRequirementRule"
```

---

### Task 10: Implement `PresenceRequirementRule`

**Files:**
- Create: `apps/webapp/src/lib/compliance/rules/presence-requirement-rule.ts`

**Step 1: Implement the rule**

```typescript
/**
 * Presence Requirement Rule
 *
 * Detects when an employee does not meet the on-site presence requirement
 * defined in their work policy (e.g., "3 days in office per week").
 */

import { DateTime } from "luxon";
import type { PresenceRequirementEvidence } from "@/db/schema/compliance-finding";
import type { ComplianceFindingResult, ComplianceRule, EmployeeWithPolicy, RuleDetectionInput, WorkPeriodData } from "./types";

const ONSITE_LOCATION_TYPES = ["office", "field"] as const;

/** Extended work period with location type */
export interface WorkPeriodWithLocation extends WorkPeriodData {
	workLocationType: string | null;
}

/** Absence day entry */
export interface AbsenceDay {
	date: string; // ISO date
	reason: string;
}

/** Holiday day entry */
export interface HolidayDay {
	date: string; // ISO date
}

/** Presence policy configuration */
export interface PresenceConfig {
	presenceMode: "minimum_count" | "fixed_days";
	requiredOnsiteDays: number | null;
	requiredOnsiteFixedDays: string[] | null; // day_of_week values
	locationId: string | null;
	evaluationPeriod: "weekly" | "biweekly" | "monthly";
	enforcement: "block" | "warn" | "none";
}

/** Extended detection input with presence-specific data */
export interface PresenceRuleDetectionInput extends RuleDetectionInput {
	workPeriods: WorkPeriodWithLocation[];
	presenceConfig: PresenceConfig;
	absenceDays: AbsenceDay[];
	holidayDays: HolidayDay[];
}

const DAY_OF_WEEK_MAP: Record<string, number> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7,
};

export class PresenceRequirementRule implements ComplianceRule {
	readonly name = "presence_requirement";
	readonly type = "presence_requirement" as const;
	readonly description = "Detects when on-site presence days are below the policy requirement";

	async detectViolations(input: PresenceRuleDetectionInput): Promise<ComplianceFindingResult[]> {
		const { employee, workPeriods, dateRange, presenceConfig, absenceDays, holidayDays } = input;
		const findings: ComplianceFindingResult[] = [];

		if (presenceConfig.enforcement === "none") {
			return findings;
		}

		// Collect excluded dates (absences + holidays) as ISO date strings
		const excludedDateSet = new Set<string>();
		const excludedDateReasons = new Map<string, string>();

		for (const absence of absenceDays) {
			excludedDateSet.add(absence.date);
			excludedDateReasons.set(absence.date, absence.reason);
		}
		for (const holiday of holidayDays) {
			excludedDateSet.add(holiday.date);
			if (!excludedDateReasons.has(holiday.date)) {
				excludedDateReasons.set(holiday.date, "holiday");
			}
		}

		// Determine on-site days: group work periods by calendar date, check if any are on-site
		const onsiteDates = new Set<string>();
		const onsiteWorkPeriodIds: string[] = [];

		for (const wp of workPeriods) {
			if (wp.endTime === null || wp.isActive) continue;

			const isOnsite = wp.workLocationType !== null &&
				ONSITE_LOCATION_TYPES.includes(wp.workLocationType as typeof ONSITE_LOCATION_TYPES[number]);

			if (isOnsite) {
				const dateStr = DateTime.fromJSDate(wp.startTime, { zone: employee.timezone }).toISODate()!;
				if (!excludedDateSet.has(dateStr)) {
					onsiteDates.add(dateStr);
					onsiteWorkPeriodIds.push(wp.id);
				}
			}
		}

		const actualOnsiteDays = onsiteDates.size;

		if (presenceConfig.presenceMode === "minimum_count") {
			const required = presenceConfig.requiredOnsiteDays ?? 0;

			// Count working days in the period (weekdays by default), minus excluded days
			const workingDaysInPeriod = this.countWorkingDays(dateRange.start, dateRange.end, employee.timezone, excludedDateSet);

			// Cap requirement to available days
			const adjustedRequirement = Math.min(required, workingDaysInPeriod);

			if (actualOnsiteDays < adjustedRequirement) {
				const shortfall = adjustedRequirement - actualOnsiteDays;
				const severity = this.calculatePresenceSeverity(actualOnsiteDays, adjustedRequirement);

				const evidence: PresenceRequirementEvidence = {
					type: "presence_requirement",
					mode: "minimum_count",
					evaluationStart: dateRange.start.toISODate()!,
					evaluationEnd: dateRange.end.toISODate()!,
					requiredDays: adjustedRequirement,
					actualOnsiteDays,
					excludedDays: [...excludedDateSet],
					excludedReasons: [...new Set(excludedDateReasons.values())],
					onsiteWorkPeriodIds,
					locationId: presenceConfig.locationId,
					locationName: null, // Resolved at a higher layer if needed
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: dateRange.end.toJSDate(),
					periodStart: dateRange.start.toJSDate(),
					periodEnd: dateRange.end.toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		} else if (presenceConfig.presenceMode === "fixed_days") {
			const requiredDays = presenceConfig.requiredOnsiteFixedDays ?? [];
			const missedDays: string[] = [];

			for (const dayName of requiredDays) {
				const dayNumber = DAY_OF_WEEK_MAP[dayName];
				if (dayNumber === undefined) continue;

				// Find the actual date for this day of week in the evaluation period
				let cursor = dateRange.start;
				while (cursor <= dateRange.end) {
					if (cursor.weekday === dayNumber) {
						const dateStr = cursor.toISODate()!;
						// Skip if excluded (holiday, absence)
						if (!excludedDateSet.has(dateStr) && !onsiteDates.has(dateStr)) {
							missedDays.push(dayName);
						}
						break;
					}
					cursor = cursor.plus({ days: 1 });
				}
			}

			if (missedDays.length > 0) {
				const totalRequired = requiredDays.length;
				const metDays = totalRequired - missedDays.length;
				const severity = this.calculatePresenceSeverity(metDays, totalRequired);

				const evidence: PresenceRequirementEvidence = {
					type: "presence_requirement",
					mode: "fixed_days",
					evaluationStart: dateRange.start.toISODate()!,
					evaluationEnd: dateRange.end.toISODate()!,
					requiredDays: totalRequired,
					actualOnsiteDays,
					missedDays,
					excludedDays: [...excludedDateSet],
					excludedReasons: [...new Set(excludedDateReasons.values())],
					onsiteWorkPeriodIds,
					locationId: presenceConfig.locationId,
					locationName: null,
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: dateRange.end.toJSDate(),
					periodStart: dateRange.start.toJSDate(),
					periodEnd: dateRange.end.toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		}

		return findings;
	}

	/** Count weekdays in a range, excluding specific dates */
	private countWorkingDays(
		start: DateTime,
		end: DateTime,
		timezone: string,
		excludedDates: Set<string>,
	): number {
		let count = 0;
		let cursor = start.startOf("day");
		const endDay = end.startOf("day");

		while (cursor <= endDay) {
			const isWeekday = cursor.weekday >= 1 && cursor.weekday <= 5;
			const dateStr = cursor.toISODate()!;
			if (isWeekday && !excludedDates.has(dateStr)) {
				count++;
			}
			cursor = cursor.plus({ days: 1 });
		}

		return count;
	}

	/** Calculate severity for presence shortfall */
	private calculatePresenceSeverity(
		actual: number,
		required: number,
	): "info" | "warning" | "critical" {
		if (required === 0) return "info";
		const shortfallPercent = ((required - actual) / required) * 100;

		if (shortfallPercent >= 66) return "critical"; // Missed 2/3 or more
		if (shortfallPercent >= 33) return "warning"; // Missed 1/3 or more
		return "info";
	}
}
```

**Step 2: Run tests to verify they pass**

```bash
cd apps/webapp
npx vitest run src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts
```

Expected: all tests PASS.

**Step 3: Commit**

```bash
git add apps/webapp/src/lib/compliance/rules/presence-requirement-rule.ts
git commit -m "feat(presence): implement PresenceRequirementRule for compliance detection"
```

---

### Task 11: Register the rule in the compliance rules registry

**Files:**
- Modify: `apps/webapp/src/lib/compliance/rules/index.ts`

**Step 1: Add export and import**

```typescript
export * from "./presence-requirement-rule";

import { PresenceRequirementRule } from "./presence-requirement-rule";
```

**Step 2: Add to COMPLIANCE_RULES array**

```typescript
export const COMPLIANCE_RULES: ComplianceRule[] = [
	new RestPeriodRule(),
	new MaxDailyHoursRule(),
	new MaxWeeklyHoursRule(),
	new ConsecutiveDaysRule(),
	new PresenceRequirementRule(),
];
```

**Step 3: Update `getEnabledRules` to include presence**

Add to the `enabledTypes` parameter and the switch:

```typescript
export function getEnabledRules(enabledTypes: {
	restPeriod: boolean;
	maxHoursDaily: boolean;
	maxHoursWeekly: boolean;
	consecutiveDays: boolean;
	presenceRequirement: boolean;
}): ComplianceRule[] {
	return COMPLIANCE_RULES.filter((rule) => {
		switch (rule.type) {
			// ... existing cases
			case "presence_requirement":
				return enabledTypes.presenceRequirement;
			default:
				return false;
		}
	});
}
```

**Step 4: Commit**

```bash
git add apps/webapp/src/lib/compliance/rules/index.ts
git commit -m "feat(presence): register PresenceRequirementRule in compliance rules"
```

---

### Task 12: Add `detectPresenceRequirement` to compliance config

**Files:**
- Modify: `apps/webapp/src/db/schema/compliance-finding.ts`

**Step 1: Add detection toggle to `complianceConfig` table**

Add after `detectConsecutiveDays` (around line 174):

```typescript
detectPresenceRequirement: boolean("detect_presence_requirement").default(true).notNull(),
```

**Step 2: Commit**

```bash
git add apps/webapp/src/db/schema/compliance-finding.ts
git commit -m "feat(presence): add detectPresenceRequirement toggle to complianceConfig"
```

---

### Task 13: Update server actions for presence CRUD

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`

This is the largest server action file (1819 lines). The key changes:

**Step 1: Update `CreateWorkPolicyInput` and `UpdateWorkPolicyInput` interfaces**

Add `presence` to both interfaces:

```typescript
presence?: {
	presenceMode: "minimum_count" | "fixed_days";
	requiredOnsiteDays?: number;
	requiredOnsiteFixedDays?: string[];
	locationId?: string;
	evaluationPeriod?: "weekly" | "biweekly" | "monthly";
	enforcement?: "block" | "warn" | "none";
};
```

**Step 2: Update `createWorkPolicy` action**

After the existing schedule and regulation insert blocks, add:

```typescript
// Create presence config if enabled
if (data.presenceEnabled && data.presence) {
	await db.insert(workPolicyPresence).values({
		policyId: newPolicy.id,
		presenceMode: data.presence.presenceMode,
		requiredOnsiteDays: data.presence.requiredOnsiteDays ?? null,
		requiredOnsiteFixedDays: data.presence.requiredOnsiteFixedDays
			? JSON.stringify(data.presence.requiredOnsiteFixedDays)
			: null,
		locationId: data.presence.locationId ?? null,
		evaluationPeriod: data.presence.evaluationPeriod ?? "weekly",
		enforcement: data.presence.enforcement ?? "warn",
	});
}
```

**Step 3: Update `updateWorkPolicy` action**

In the delete-and-recreate pattern, add deletion of old presence:

```typescript
await db.delete(workPolicyPresence).where(eq(workPolicyPresence.policyId, policyId));
```

Then add recreation (same as create step).

**Step 4: Update `WorkPolicyWithDetails` type**

Add `presence` to the return type to include the presence config when fetching policies.

**Step 5: Update `getWorkPolicy` and `getWorkPolicies` queries**

Include `presence` relation in the `with` clause of Drizzle queries:

```typescript
with: {
	schedule: { with: { days: true } },
	regulation: { with: { breakRules: { with: { options: true } } } },
	presence: true,  // NEW
}
```

**Step 6: Add `presenceEnabled` to the `CreateWorkPolicyInput` interface**

```typescript
presenceEnabled: boolean;
```

**Step 7: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts
git commit -m "feat(presence): add presence CRUD to work policy server actions"
```

---

### Task 14: Update `workLocationType` in clock-in action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`

**Step 1: Add `workLocationType` parameter to `clockIn` action**

Find the `clockIn` function and add a `workLocationType` parameter:

```typescript
export async function clockIn(
	workLocationType?: "office" | "home" | "field" | "other",
): Promise<ServerActionResult<ClockInResult>> {
```

**Step 2: Pass to workPeriod insert**

Where the `workPeriod` is created, add:

```typescript
workLocationType: workLocationType ?? null,
```

**Step 3: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts
git commit -m "feat(presence): add workLocationType parameter to clockIn action"
```

---

### Task 15: Update clock-in UI with location selector

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`

**Step 1: Add location type state**

```typescript
const [workLocationType, setWorkLocationType] = useState<"office" | "home" | "field" | "other">(() => {
	// Sticky preference from localStorage
	if (typeof window !== "undefined") {
		return (localStorage.getItem("z8-work-location-type") as any) ?? "office";
	}
	return "office";
});
```

**Step 2: Add segmented control before the clock-in button**

Use existing Radix UI primitives (ToggleGroup or similar) to render:
- Office / Home / Field / Other

**Step 3: Persist selection**

```typescript
useEffect(() => {
	localStorage.setItem("z8-work-location-type", workLocationType);
}, [workLocationType]);
```

**Step 4: Pass to clockIn call**

```typescript
await clockIn(workLocationType);
```

**Step 5: Commit**

```bash
git add apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx
git commit -m "feat(presence): add work location selector to clock-in widget"
```

---

### Task 16: Add presence section to work policy dialog

**Files:**
- Modify: `apps/webapp/src/components/settings/work-policy-dialog.tsx`

**Step 1: Add `presenceEnabled` toggle**

In the Feature Toggles section (alongside `scheduleEnabled` and `regulationEnabled`), add a third toggle for "Presence Requirements".

**Step 2: Add presence config form section**

When `presenceEnabled` is true, render:
- Mode radio: "Minimum days on-site" / "Fixed specific days"
- If minimum: number input for `requiredOnsiteDays`
- If fixed: day-of-week checkboxes (Mon-Sun)
- Evaluation period dropdown (Weekly / Biweekly / Monthly)
- Location dropdown (optional, from org locations)
- Enforcement selector (None / Warn / Escalate)

**Step 3: Add form fields to TanStack Form**

Add to `defaultValues`:

```typescript
presenceEnabled: policy?.presenceEnabled ?? false,
presence: {
	presenceMode: policy?.presence?.presenceMode ?? "minimum_count",
	requiredOnsiteDays: policy?.presence?.requiredOnsiteDays ?? 3,
	requiredOnsiteFixedDays: policy?.presence?.requiredOnsiteFixedDays
		? JSON.parse(policy.presence.requiredOnsiteFixedDays)
		: [],
	locationId: policy?.presence?.locationId ?? "",
	evaluationPeriod: policy?.presence?.evaluationPeriod ?? "weekly",
	enforcement: policy?.presence?.enforcement ?? "warn",
},
```

**Step 4: Add client-side validation**

- `requiredOnsiteDays` must be >= 1 and <= 7
- `requiredOnsiteFixedDays` must have at least 1 day selected in fixed mode
- If `presenceEnabled`, at least one of the above must be set

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/work-policy-dialog.tsx
git commit -m "feat(presence): add presence configuration section to work policy dialog"
```

---

### Task 17: Update work policy table to show presence info

**Files:**
- Modify: `apps/webapp/src/components/settings/work-policy-table.tsx`

**Step 1: Add "Presence" to the features column**

In the features column renderer, add a badge/chip for presence (alongside schedule and regulation badges):

```typescript
{policy.presenceEnabled && (
	<Badge variant="outline">Presence</Badge>
)}
```

**Step 2: Optionally add a presence summary column**

Show "3 days/week" or "Mon/Wed/Fri" depending on mode.

**Step 3: Commit**

```bash
git add apps/webapp/src/components/settings/work-policy-table.tsx
git commit -m "feat(presence): show presence info in work policy table"
```

---

### Task 18: Add translations

**Files:**
- Modify: `apps/webapp/messages/settings/en.json`

**Step 1: Add translation keys**

Under the `settings.workPolicies` namespace, add:

```json
"presenceEnabled": "Presence Requirements",
"presenceEnabledDescription": "Set on-site attendance requirements for employees",
"presenceMode": "Mode",
"presenceModeMinimumCount": "Minimum days on-site",
"presenceModeFixedDays": "Fixed specific days",
"presenceRequiredDays": "Required on-site days",
"presenceFixedDays": "Required on-site days of the week",
"presenceEvaluationPeriod": "Evaluation period",
"presenceEvaluationWeekly": "Weekly",
"presenceEvaluationBiweekly": "Biweekly",
"presenceEvaluationMonthly": "Monthly",
"presenceLocation": "Required location",
"presenceLocationAny": "Any location",
"presenceEnforcement": "Enforcement",
"presenceEnforcementNone": "None (track only)",
"presenceEnforcementWarn": "Warn (notify employee & manager)",
"presenceEnforcementBlock": "Escalate (notify + flag on dashboard)",
"presenceSummaryDaysPerWeek": "{count} days/week on-site",
"presenceSummaryFixedDays": "On-site: {days}",
"workLocationOffice": "Office",
"workLocationHome": "Home",
"workLocationField": "Field",
"workLocationOther": "Other",
"workLocationLabel": "Work location",
"presenceProgress": "{current}/{required} days on-site this {period}",
"presenceViolation": "Presence requirement not met"
```

**Step 2: Commit**

```bash
git add apps/webapp/messages/settings/en.json
git commit -m "feat(presence): add English translations for presence policy"
```

---

### Task 19: Add presence detection to nightly compliance radar job

**Files:**
- Modify: `apps/webapp/src/lib/jobs/compliance-radar-processor.ts`
- Modify: `apps/webapp/src/lib/effect/services/compliance-detection.service.ts`

**Step 1: Update `compliance-detection.service.ts`**

In the `detectForEmployee` method, after loading work periods and running existing rules, add a section to:
1. Check if the employee's effective policy has `presenceEnabled`
2. If yes, load the `workPolicyPresence` config
3. Load absence entries and holidays for the evaluation period
4. Load work periods with `workLocationType` included
5. Instantiate `PresenceRequirementRule` and call `detectViolations`
6. Append any findings

**Step 2: Update `compliance-radar-processor.ts`**

In `runComplianceRadarDetection()`, add the `presenceRequirement` flag to the enabled rules check, reading from `complianceConfig.detectPresenceRequirement`.

The presence rule evaluation differs from other rules in timing: it evaluates weekly (every Monday) or monthly (every 1st), not daily. Add logic to check if today is an evaluation trigger day before running the presence rule.

**Step 3: Commit**

```bash
git add apps/webapp/src/lib/jobs/compliance-radar-processor.ts apps/webapp/src/lib/effect/services/compliance-detection.service.ts
git commit -m "feat(presence): integrate presence detection into nightly compliance radar job"
```

---

### Task 20: Add presence query keys and dashboard hook

**Files:**
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Create: `apps/webapp/src/hooks/use-presence-status.ts`

**Step 1: Add query keys**

In `keys.ts`, under `workPolicies`, add:

```typescript
presence: {
	status: (employeeId: string) => ["work-policies", "presence", "status", employeeId],
},
```

**Step 2: Create presence status hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { getPresenceStatus } from "@/app/[locale]/(app)/time-tracking/actions";

export function usePresenceStatus(employeeId: string | undefined) {
	return useQuery({
		queryKey: queryKeys.workPolicies.presence.status(employeeId ?? ""),
		queryFn: () => getPresenceStatus(employeeId!),
		enabled: !!employeeId,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}
```

**Step 3: Add `getPresenceStatus` server action**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`, add a server action that:
1. Gets the employee's effective policy
2. If `presenceEnabled`, queries work periods for the current evaluation period
3. Counts on-site days
4. Returns `{ required: number, actual: number, period: string, mode: string }`

**Step 4: Commit**

```bash
git add apps/webapp/src/lib/query/keys.ts apps/webapp/src/hooks/use-presence-status.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts
git commit -m "feat(presence): add presence status hook and server action"
```

---

### Task 21: Add presence dashboard widget

**Files:**
- Create: `apps/webapp/src/components/dashboard/presence-status-widget.tsx`

**Step 1: Implement the widget**

A small card component that uses `usePresenceStatus` to show:
- Progress bar: "2/3 days on-site this week"
- Warning color if behind pace (e.g., Thursday with 1/3)
- Link to presence policy details

Follow the pattern of existing dashboard widgets (e.g., `compliance-radar-widget.tsx`).

**Step 2: Add the widget to the dashboard layout**

Find the dashboard page/layout and add the `<PresenceStatusWidget />` alongside existing widgets. Only render when the employee's policy has `presenceEnabled`.

**Step 3: Commit**

```bash
git add apps/webapp/src/components/dashboard/presence-status-widget.tsx
git commit -m "feat(presence): add presence status dashboard widget"
```

---

### Task 22: Run full test suite and fix issues

**Step 1: Run all tests**

```bash
cd apps/webapp
npx vitest run
```

**Step 2: Fix any failures**

Existing tests may break if they rely on:
- The shape of `ComplianceFindingEvidence` union (add `presence_requirement` to any switch/if chains)
- The `complianceFindingTypeEnum` values (update test fixtures)
- The `workPolicy` table shape (add `presenceEnabled` to test fixtures)
- The `getEnabledRules` function signature (add `presenceRequirement` parameter)

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix(presence): fix existing tests after presence policy schema changes"
```

---

### Task 23: Run type check and build

**Step 1: Run TypeScript type check**

```bash
cd apps/webapp
npx tsc --noEmit
```

**Step 2: Fix any type errors**

Common issues:
- Missing `presenceEnabled` in existing code that spreads `workPolicy` fields
- Missing `workLocationType` in work period type assertions
- Missing `presence_requirement` in switch/case exhaustiveness checks

**Step 3: Run build**

```bash
cd apps/webapp
npm run build
```

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(presence): resolve type errors and build issues"
```
