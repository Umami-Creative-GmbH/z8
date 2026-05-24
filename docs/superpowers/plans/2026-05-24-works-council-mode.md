# Works Council Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-first, read-only Works Council Mode with organization settings, restricted portal access, dashboard/review data, and audited review exports.

**Architecture:** Add organization-scoped Works Council settings and audit/export records, expose a dedicated CASL subject and permission set, then build server-side loaders that apply privacy transforms before rendering `/works-council`. The V1 UI is read-only and uses existing audit, schedule, compliance, absence, and time data without creating a works council negotiation workflow.

**Tech Stack:** Next.js App Router, React Server Components, Drizzle/Postgres, CASL authorization, Effect services where existing service seams are used, TanStack Form for settings forms, Vitest/Testing Library, pnpm.

---

## File Structure

- Create: `apps/webapp/src/db/schema/works-council.ts`
  - Owns `worksCouncilSettings`, `worksCouncilAccessAudit`, and `worksCouncilReviewExport` tables plus typed visibility values.
- Modify: `apps/webapp/src/db/schema/index.ts`
  - Re-export the new schema file.
- Modify: `apps/webapp/src/db/schema/relations.ts`
  - Add organization, user, and optional employee relations for works council tables.
- Create: `apps/webapp/src/db/schema/__tests__/works-council-schema.test.ts`
  - Verifies organization scoping, defaults, indexes, and enum values at schema level.
- Modify: `apps/webapp/src/lib/authorization/types.ts`
  - Add `WorksCouncil` organization subject.
- Modify: `apps/webapp/src/lib/authorization/permission-registry.ts`
  - Register read/export permissions for custom roles.
- Create: `apps/webapp/src/lib/works-council/permissions.ts`
  - Central permission helpers for portal/settings/export access.
- Create: `apps/webapp/src/lib/works-council/privacy.ts`
  - Server-only identity and absence visibility transforms plus aggregation suppression.
- Create: `apps/webapp/src/lib/works-council/privacy.test.ts`
  - Unit tests for threshold, identity, and absence transformations.
- Create: `apps/webapp/src/lib/works-council/settings.ts`
  - Settings defaults, validation, load, and save helpers.
- Create: `apps/webapp/src/lib/works-council/settings.test.ts`
  - Unit tests for default settings and validation.
- Create: `apps/webapp/src/lib/works-council/review-data.ts`
  - Server data loaders for dashboard, change log, and published schedule review.
- Create: `apps/webapp/src/lib/works-council/review-data.test.ts`
  - Unit tests for org scoping and privacy-applied outputs using fixture rows.
- Modify: `apps/webapp/src/lib/audit-logger.ts`
  - Add Works Council audit actions and target types.
- Create: `apps/webapp/src/app/[locale]/(app)/works-council/page.tsx`
  - Server page for the Works Council Portal.
- Create: `apps/webapp/src/components/works-council/works-council-dashboard.tsx`
  - Presentational dashboard, change log, schedule review, and export entry point.
- Create: `apps/webapp/src/components/works-council/works-council-dashboard.test.tsx`
  - UI state tests for normal, disabled, insufficient-data, and partial-unavailable states.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/compliance/works-council/page.tsx`
  - Admin settings page.
- Create: `apps/webapp/src/components/settings/works-council-settings-form.tsx`
  - TanStack Form settings editor.
- Create: `apps/webapp/src/components/settings/works-council-settings-form.test.tsx`
  - UI tests for conservative defaults and save payload.
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
  - Add settings nav entry and icon mapping.
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
  - Add Works Council navigation item when server layout passes access flag.
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx`
  - Compute and pass works council nav access to `AppSidebar`.
- Create: `apps/webapp/src/app/[locale]/(app)/works-council/export/route.ts`
  - Route handler for CSV review pack exports.
- Create: `apps/webapp/src/app/[locale]/(app)/works-council/export/route.test.ts`
  - Integration-style route tests for disabled export, permission denial, and audited success.

## Task 1: Data Model

**Files:**
- Create: `apps/webapp/src/db/schema/works-council.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Test: `apps/webapp/src/db/schema/__tests__/works-council-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
import { describe, expect, it } from "vitest";
import {
	worksCouncilAccessAudit,
	worksCouncilReviewExport,
	worksCouncilSettings,
} from "../works-council";

describe("works council schema", () => {
	it("defines organization-scoped settings with conservative defaults", () => {
		expect(worksCouncilSettings.organizationId.notNull).toBe(true);
		expect(worksCouncilSettings.enabled.hasDefault).toBe(true);
		expect(worksCouncilSettings.identityVisibility.hasDefault).toBe(true);
		expect(worksCouncilSettings.absenceVisibility.hasDefault).toBe(true);
		expect(worksCouncilSettings.exportEnabled.hasDefault).toBe(true);
		expect(worksCouncilSettings.minimumAggregationThreshold.hasDefault).toBe(true);
	});

	it("defines audited access and export records", () => {
		expect(worksCouncilAccessAudit.organizationId.notNull).toBe(true);
		expect(worksCouncilAccessAudit.actorUserId.notNull).toBe(true);
		expect(worksCouncilAccessAudit.eventType.notNull).toBe(true);
		expect(worksCouncilReviewExport.organizationId.notNull).toBe(true);
		expect(worksCouncilReviewExport.requestedByUserId.notNull).toBe(true);
		expect(worksCouncilReviewExport.visibilitySnapshot.notNull).toBe(true);
	});
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pnpm --filter @z8/webapp test src/db/schema/__tests__/works-council-schema.test.ts`

Expected: FAIL because `../works-council` does not exist.

- [ ] **Step 3: Add the schema file**

Create `apps/webapp/src/db/schema/works-council.ts`:

```ts
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { employee, location, team } from "./organization";

export type WorksCouncilIdentityVisibility = "aggregated" | "pseudonymized" | "named";
export type WorksCouncilAbsenceVisibility = "hidden" | "grouped" | "category";
export type WorksCouncilAccessEventType = "portal_viewed" | "settings_updated" | "export_requested" | "export_failed";

export const worksCouncilSettings = pgTable(
	"works_council_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").default(false).notNull(),
		identityVisibility: text("identity_visibility")
			.$type<WorksCouncilIdentityVisibility>()
			.default("aggregated")
			.notNull(),
		absenceVisibility: text("absence_visibility")
			.$type<WorksCouncilAbsenceVisibility>()
			.default("hidden")
			.notNull(),
		exportEnabled: boolean("export_enabled").default(false).notNull(),
		minimumAggregationThreshold: integer("minimum_aggregation_threshold").default(5).notNull(),
		visibleTeamIds: jsonb("visible_team_ids").$type<string[]>().default([]).notNull(),
		visibleLocationIds: jsonb("visible_location_ids").$type<string[]>().default([]).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		uniqueIndex("worksCouncilSettings_organizationId_idx").on(table.organizationId),
		index("worksCouncilSettings_enabled_idx").on(table.enabled),
	],
);

export const worksCouncilAccessAudit = pgTable(
	"works_council_access_audit",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id")
			.notNull()
			.references(() => user.id),
		actorEmployeeId: uuid("actor_employee_id").references(() => employee.id, { onDelete: "set null" }),
		eventType: text("event_type").$type<WorksCouncilAccessEventType>().notNull(),
		dateRangeStart: timestamp("date_range_start", { withTimezone: true }),
		dateRangeEnd: timestamp("date_range_end", { withTimezone: true }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("worksCouncilAccessAudit_org_createdAt_idx").on(table.organizationId, table.createdAt),
		index("worksCouncilAccessAudit_actor_createdAt_idx").on(table.actorUserId, table.createdAt),
		index("worksCouncilAccessAudit_eventType_idx").on(table.eventType),
	],
);

export const worksCouncilReviewExport = pgTable(
	"works_council_review_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestedByUserId: text("requested_by_user_id")
			.notNull()
			.references(() => user.id),
		requestedByEmployeeId: uuid("requested_by_employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),
		dateRangeStart: timestamp("date_range_start", { withTimezone: true }).notNull(),
		dateRangeEnd: timestamp("date_range_end", { withTimezone: true }).notNull(),
		visibilitySnapshot: jsonb("visibility_snapshot")
			.$type<{
				identityVisibility: WorksCouncilIdentityVisibility;
				absenceVisibility: WorksCouncilAbsenceVisibility;
				minimumAggregationThreshold: number;
				visibleTeamIds: string[];
				visibleLocationIds: string[];
			}>()
			.notNull(),
		status: text("status").$type<"completed" | "failed">().notNull(),
		rowCount: integer("row_count").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("worksCouncilReviewExport_org_createdAt_idx").on(table.organizationId, table.createdAt),
		index("worksCouncilReviewExport_requestedBy_idx").on(table.requestedByUserId),
		index("worksCouncilReviewExport_range_idx").on(table.organizationId, table.dateRangeStart, table.dateRangeEnd),
	],
);

export type WorksCouncilSettings = typeof worksCouncilSettings.$inferSelect;
export type NewWorksCouncilSettings = typeof worksCouncilSettings.$inferInsert;
export type WorksCouncilAccessAudit = typeof worksCouncilAccessAudit.$inferSelect;
export type WorksCouncilReviewExport = typeof worksCouncilReviewExport.$inferSelect;
```

- [ ] **Step 4: Export schema and add relations**

Add this line to `apps/webapp/src/db/schema/index.ts` near the other exports:

```ts
export * from "./works-council";
```

In `apps/webapp/src/db/schema/relations.ts`, import the tables:

```ts
import { worksCouncilAccessAudit, worksCouncilReviewExport, worksCouncilSettings } from "./works-council";
```

Add these to `organizationRelations`:

```ts
worksCouncilSettings: many(worksCouncilSettings),
worksCouncilAccessAudits: many(worksCouncilAccessAudit),
worksCouncilReviewExports: many(worksCouncilReviewExport),
```

Add relation blocks near other domain relation blocks:

```ts
export const worksCouncilSettingsRelations = relations(worksCouncilSettings, ({ one }) => ({
	organization: one(organization, {
		fields: [worksCouncilSettings.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [worksCouncilSettings.createdBy],
		references: [user.id],
	}),
	updatedByUser: one(user, {
		fields: [worksCouncilSettings.updatedBy],
		references: [user.id],
	}),
}));

export const worksCouncilAccessAuditRelations = relations(worksCouncilAccessAudit, ({ one }) => ({
	organization: one(organization, {
		fields: [worksCouncilAccessAudit.organizationId],
		references: [organization.id],
	}),
	actorUser: one(user, {
		fields: [worksCouncilAccessAudit.actorUserId],
		references: [user.id],
	}),
	actorEmployee: one(employee, {
		fields: [worksCouncilAccessAudit.actorEmployeeId],
		references: [employee.id],
	}),
}));

export const worksCouncilReviewExportRelations = relations(worksCouncilReviewExport, ({ one }) => ({
	organization: one(organization, {
		fields: [worksCouncilReviewExport.organizationId],
		references: [organization.id],
	}),
	requestedByUser: one(user, {
		fields: [worksCouncilReviewExport.requestedByUserId],
		references: [user.id],
	}),
	requestedByEmployee: one(employee, {
		fields: [worksCouncilReviewExport.requestedByEmployeeId],
		references: [employee.id],
	}),
}));
```

- [ ] **Step 5: Run schema test and generate migration**

Run: `pnpm --filter @z8/webapp test src/db/schema/__tests__/works-council-schema.test.ts`

Expected: PASS.

Run: `pnpm --filter @z8/webapp drizzle-kit generate`

Expected: a new migration and `apps/webapp/drizzle/meta/_journal.json` entry with a `when` greater than prior entries. Inspect the generated SQL to confirm it creates only `works_council_settings`, `works_council_access_audit`, and `works_council_review_export` plus indexes.

- [ ] **Step 6: Commit data model**

```bash
git add apps/webapp/src/db/schema/works-council.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/works-council-schema.test.ts apps/webapp/drizzle
git commit -m "feat: add works council data model"
```

## Task 2: Authorization And Privacy Helpers

**Files:**
- Modify: `apps/webapp/src/lib/authorization/types.ts`
- Modify: `apps/webapp/src/lib/authorization/permission-registry.ts`
- Create: `apps/webapp/src/lib/works-council/permissions.ts`
- Create: `apps/webapp/src/lib/works-council/privacy.ts`
- Test: `apps/webapp/src/lib/works-council/privacy.test.ts`

- [ ] **Step 1: Write privacy helper tests**

```ts
import { describe, expect, it } from "vitest";
import { applyAbsenceVisibility, applyIdentityVisibility, suppressSmallGroups } from "./privacy";

describe("works council privacy helpers", () => {
	it("suppresses groups below the configured threshold", () => {
		expect(suppressSmallGroups({ count: 4, threshold: 5, value: 120 })).toEqual({
			state: "insufficient_data",
			count: 4,
			value: null,
		});
		expect(suppressSmallGroups({ count: 5, threshold: 5, value: 120 })).toEqual({
			state: "available",
			count: 5,
			value: 120,
		});
	});

	it("applies identity visibility modes", () => {
		const rows = [
			{ employeeId: "emp-1", employeeName: "Ada Lovelace" },
			{ employeeId: "emp-2", employeeName: "Grace Hopper" },
		];

		expect(applyIdentityVisibility(rows, "aggregated")).toEqual([
			{ employeeId: null, employeeName: null },
			{ employeeId: null, employeeName: null },
		]);
		expect(applyIdentityVisibility(rows, "pseudonymized")).toEqual([
			{ employeeId: "emp-1", employeeName: "Employee A" },
			{ employeeId: "emp-2", employeeName: "Employee B" },
		]);
		expect(applyIdentityVisibility(rows, "named")).toEqual(rows);
	});

	it("applies absence visibility modes", () => {
		const row = { absenceCategory: "Sick Leave", absenceGroup: "sick_leave" as const };
		expect(applyAbsenceVisibility(row, "hidden")).toEqual({ absenceCategory: null });
		expect(applyAbsenceVisibility(row, "grouped")).toEqual({ absenceCategory: "sick_leave" });
		expect(applyAbsenceVisibility(row, "category")).toEqual({ absenceCategory: "Sick Leave" });
	});
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @z8/webapp test src/lib/works-council/privacy.test.ts`

Expected: FAIL because `./privacy` does not exist.

- [ ] **Step 3: Add authorization subject and permissions**

In `apps/webapp/src/lib/authorization/types.ts`, add `"WorksCouncil"` to `OrganizationSubject` and add this mapping to `SubjectTypeMap`:

```ts
WorksCouncil: OrgScopedSubject;
```

In `apps/webapp/src/lib/authorization/permission-registry.ts`, add `"works_council"` to `PermissionCategory` and add definitions:

```ts
"read:WorksCouncil": {
	action: "read",
	subject: "WorksCouncil",
	category: "works_council",
	label: "View Works Council Portal",
	description: "Read privacy-filtered works council dashboards and review logs",
},
"export:WorksCouncil": {
	action: "export",
	subject: "WorksCouncil",
	category: "works_council",
	label: "Export Works Council Review Packs",
	description: "Generate privacy-filtered works council review exports",
},
"configure:WorksCouncil": {
	action: "configure",
	subject: "WorksCouncil",
	category: "works_council",
	label: "Configure Works Council Mode",
	description: "Enable Works Council Mode and configure privacy settings",
},
```

- [ ] **Step 4: Add permission helper**

Create `apps/webapp/src/lib/works-council/permissions.ts`:

```ts
import type { AppAbility } from "@/lib/authorization/ability";

export interface WorksCouncilSubjectInput {
	organizationId: string;
}

export function canViewWorksCouncilPortal(ability: AppAbility, organizationId: string): boolean {
	return ability.can("read", { organizationId, __typename: "WorksCouncil" } as never);
}

export function canExportWorksCouncilReview(ability: AppAbility, organizationId: string): boolean {
	return ability.can("export", { organizationId, __typename: "WorksCouncil" } as never);
}

export function canConfigureWorksCouncilMode(ability: AppAbility, organizationId: string): boolean {
	return ability.can("configure", { organizationId, __typename: "WorksCouncil" } as never);
}
```

- [ ] **Step 5: Verify permission helper integration**

Run: `pnpm --filter @z8/webapp test src/lib/authorization/permission-registry.test.ts src/lib/works-council/privacy.test.ts`

Expected: PASS. If `AppAbility` checks reject object subjects with `__typename`, replace the three helper bodies with this direct subject form and run the same command again:

```ts
export function canViewWorksCouncilPortal(ability: AppAbility, organizationId: string): boolean {
	return ability.can("read", "WorksCouncil") && organizationId.length > 0;
}

export function canExportWorksCouncilReview(ability: AppAbility, organizationId: string): boolean {
	return ability.can("export", "WorksCouncil") && organizationId.length > 0;
}

export function canConfigureWorksCouncilMode(ability: AppAbility, organizationId: string): boolean {
	return ability.can("configure", "WorksCouncil") && organizationId.length > 0;
}
```

- [ ] **Step 6: Add privacy helper implementation**

Create `apps/webapp/src/lib/works-council/privacy.ts`:

```ts
import type { WorksCouncilAbsenceVisibility, WorksCouncilIdentityVisibility } from "@/db/schema/works-council";

export type SuppressedValue<T> =
	| { state: "available"; count: number; value: T }
	| { state: "insufficient_data"; count: number; value: null };

export function suppressSmallGroups<T>(input: { count: number; threshold: number; value: T }): SuppressedValue<T> {
	if (input.count < input.threshold) {
		return { state: "insufficient_data", count: input.count, value: null };
	}

	return { state: "available", count: input.count, value: input.value };
}

export function applyIdentityVisibility<T extends { employeeId: string | null; employeeName: string | null }>(
	rows: T[],
	visibility: WorksCouncilIdentityVisibility,
): T[] {
	if (visibility === "named") return rows;

	if (visibility === "aggregated") {
		return rows.map((row) => ({ ...row, employeeId: null, employeeName: null }));
	}

	const labels = new Map<string, string>();
	return rows.map((row) => {
		if (!row.employeeId) return { ...row, employeeName: null };
		if (!labels.has(row.employeeId)) {
			labels.set(row.employeeId, `Employee ${String.fromCharCode(65 + labels.size)}`);
		}
		return { ...row, employeeName: labels.get(row.employeeId) ?? "Employee" };
	});
}

export function applyAbsenceVisibility(
	row: { absenceCategory: string | null; absenceGroup: "planned" | "sick_leave" | "other" | null },
	visibility: WorksCouncilAbsenceVisibility,
): { absenceCategory: string | null } {
	if (visibility === "hidden") return { absenceCategory: null };
	if (visibility === "grouped") return { absenceCategory: row.absenceGroup };
	return { absenceCategory: row.absenceCategory };
}
```

- [ ] **Step 7: Run tests and commit**

Run: `pnpm --filter @z8/webapp test src/lib/works-council/privacy.test.ts`

Expected: PASS.

```bash
git add apps/webapp/src/lib/authorization/types.ts apps/webapp/src/lib/authorization/permission-registry.ts apps/webapp/src/lib/works-council/permissions.ts apps/webapp/src/lib/works-council/privacy.ts apps/webapp/src/lib/works-council/privacy.test.ts
git commit -m "feat: add works council privacy permissions"
```

## Task 3: Settings Page And Persistence

**Files:**
- Create: `apps/webapp/src/lib/works-council/settings.ts`
- Test: `apps/webapp/src/lib/works-council/settings.test.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/compliance/works-council/page.tsx`
- Create: `apps/webapp/src/components/settings/works-council-settings-form.tsx`
- Test: `apps/webapp/src/components/settings/works-council-settings-form.test.tsx`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`

- [ ] **Step 1: Write settings helper tests**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKS_COUNCIL_SETTINGS, normalizeWorksCouncilSettingsInput } from "./settings";

describe("works council settings", () => {
	it("uses conservative defaults", () => {
		expect(DEFAULT_WORKS_COUNCIL_SETTINGS).toEqual({
			enabled: false,
			identityVisibility: "aggregated",
			absenceVisibility: "hidden",
			exportEnabled: false,
			minimumAggregationThreshold: 5,
			visibleTeamIds: [],
			visibleLocationIds: [],
		});
	});

	it("clamps minimum aggregation threshold to at least five", () => {
		expect(normalizeWorksCouncilSettingsInput({ minimumAggregationThreshold: 2 }).minimumAggregationThreshold).toBe(5);
		expect(normalizeWorksCouncilSettingsInput({ minimumAggregationThreshold: 12 }).minimumAggregationThreshold).toBe(12);
	});
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @z8/webapp test src/lib/works-council/settings.test.ts`

Expected: FAIL because `./settings` does not exist.

- [ ] **Step 3: Add settings helper**

Create `apps/webapp/src/lib/works-council/settings.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { worksCouncilSettings, type WorksCouncilAbsenceVisibility, type WorksCouncilIdentityVisibility } from "@/db/schema";

export interface WorksCouncilSettingsInput {
	enabled?: boolean;
	identityVisibility?: WorksCouncilIdentityVisibility;
	absenceVisibility?: WorksCouncilAbsenceVisibility;
	exportEnabled?: boolean;
	minimumAggregationThreshold?: number;
	visibleTeamIds?: string[];
	visibleLocationIds?: string[];
}

export const DEFAULT_WORKS_COUNCIL_SETTINGS = {
	enabled: false,
	identityVisibility: "aggregated" as const,
	absenceVisibility: "hidden" as const,
	exportEnabled: false,
	minimumAggregationThreshold: 5,
	visibleTeamIds: [] as string[],
	visibleLocationIds: [] as string[],
};

export function normalizeWorksCouncilSettingsInput(input: WorksCouncilSettingsInput) {
	return {
		enabled: input.enabled ?? DEFAULT_WORKS_COUNCIL_SETTINGS.enabled,
		identityVisibility: input.identityVisibility ?? DEFAULT_WORKS_COUNCIL_SETTINGS.identityVisibility,
		absenceVisibility: input.absenceVisibility ?? DEFAULT_WORKS_COUNCIL_SETTINGS.absenceVisibility,
		exportEnabled: input.exportEnabled ?? DEFAULT_WORKS_COUNCIL_SETTINGS.exportEnabled,
		minimumAggregationThreshold: Math.max(
			DEFAULT_WORKS_COUNCIL_SETTINGS.minimumAggregationThreshold,
			input.minimumAggregationThreshold ?? DEFAULT_WORKS_COUNCIL_SETTINGS.minimumAggregationThreshold,
		),
		visibleTeamIds: input.visibleTeamIds ?? DEFAULT_WORKS_COUNCIL_SETTINGS.visibleTeamIds,
		visibleLocationIds: input.visibleLocationIds ?? DEFAULT_WORKS_COUNCIL_SETTINGS.visibleLocationIds,
	};
}

export async function loadWorksCouncilSettings(organizationId: string) {
	const row = await db.query.worksCouncilSettings.findFirst({
		where: eq(worksCouncilSettings.organizationId, organizationId),
	});
	return row ?? { organizationId, ...DEFAULT_WORKS_COUNCIL_SETTINGS };
}

export async function saveWorksCouncilSettings(input: WorksCouncilSettingsInput & { organizationId: string; actorUserId: string }) {
	const normalized = normalizeWorksCouncilSettingsInput(input);
	const [row] = await db
		.insert(worksCouncilSettings)
		.values({ ...normalized, organizationId: input.organizationId, createdBy: input.actorUserId, updatedBy: input.actorUserId })
		.onConflictDoUpdate({
			target: worksCouncilSettings.organizationId,
			set: { ...normalized, updatedBy: input.actorUserId },
		})
		.returning();
	return row;
}
```

- [ ] **Step 4: Add settings nav entry**

In `apps/webapp/src/components/settings/settings-config.ts`, add `"users"` if no dedicated works council icon is needed, or add `"gavel"` to `SettingsIconName` if it is not already present. Add this entry near compliance settings:

```ts
{
	id: "works-council",
	titleKey: "settings.worksCouncil.title",
	titleDefault: "Works Council Mode",
	descriptionKey: "settings.worksCouncil.description",
	descriptionDefault: "Configure privacy-safe Betriebsrat access and review exports",
	href: "/settings/compliance/works-council",
	icon: "gavel",
	minimumTier: "orgAdmin",
	group: "enterprise",
},
```

- [ ] **Step 5: Add settings page and form skeleton**

Create `apps/webapp/src/app/[locale]/(app)/settings/compliance/works-council/page.tsx`:

```tsx
import { WorksCouncilSettingsForm } from "@/components/settings/works-council-settings-form";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";
import { getCurrentOrganizationIdOrThrow } from "@/lib/auth-helpers";

export default async function WorksCouncilSettingsPage() {
	const organizationId = await getCurrentOrganizationIdOrThrow();
	const settings = await loadWorksCouncilSettings(organizationId);

	return <WorksCouncilSettingsForm initialSettings={settings} />;
}
```

Create `apps/webapp/src/components/settings/works-council-settings-form.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import type { WorksCouncilSettings } from "@/db/schema";

interface WorksCouncilSettingsFormProps {
	initialSettings: WorksCouncilSettings | (WorksCouncilSettings & { organizationId: string });
}

export function WorksCouncilSettingsForm({ initialSettings }: WorksCouncilSettingsFormProps) {
	const form = useForm({
		defaultValues: {
			enabled: initialSettings.enabled,
			identityVisibility: initialSettings.identityVisibility,
			absenceVisibility: initialSettings.absenceVisibility,
			exportEnabled: initialSettings.exportEnabled,
			minimumAggregationThreshold: initialSettings.minimumAggregationThreshold,
		},
		onSubmit: async () => {},
	});

	return (
		<form
			className="space-y-6"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Works Council Mode</h1>
				<p className="text-muted-foreground">Configure privacy-safe Betriebsrat access for this organization.</p>
			</div>
			<form.Field name="enabled">
				{(field) => (
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={field.state.value}
							onChange={(event) => field.handleChange(event.target.checked)}
						/>
						Enable Works Council Mode
					</label>
				)}
			</form.Field>
			<form.Field name="minimumAggregationThreshold">
				{(field) => (
					<label className="grid gap-2">
						<span>Minimum aggregation threshold</span>
						<input
							className="rounded-md border bg-background px-3 py-2"
							type="number"
							min={5}
							value={field.state.value}
							onChange={(event) => field.handleChange(Number(event.target.value))}
						/>
					</label>
				)}
			</form.Field>
			<button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" type="submit">
				Save settings
			</button>
		</form>
	);
}
```

- [ ] **Step 6: Run settings tests and commit**

Run: `pnpm --filter @z8/webapp test src/lib/works-council/settings.test.ts`

Expected: PASS.

Run: `pnpm --filter @z8/webapp test src/components/settings/works-council-settings-form.test.tsx`

Expected: PASS after the form test is added with Testing Library assertions for default labels and the threshold field.

```bash
git add apps/webapp/src/lib/works-council/settings.ts apps/webapp/src/lib/works-council/settings.test.ts apps/webapp/src/app/[locale]/(app)/settings/compliance/works-council/page.tsx apps/webapp/src/components/settings/works-council-settings-form.tsx apps/webapp/src/components/settings/works-council-settings-form.test.tsx apps/webapp/src/components/settings/settings-config.ts
git commit -m "feat: add works council settings"
```

## Task 4: Portal Data Loaders And Dashboard

**Files:**
- Create: `apps/webapp/src/lib/works-council/review-data.ts`
- Test: `apps/webapp/src/lib/works-council/review-data.test.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/works-council/page.tsx`
- Create: `apps/webapp/src/components/works-council/works-council-dashboard.tsx`
- Test: `apps/webapp/src/components/works-council/works-council-dashboard.test.tsx`

- [ ] **Step 1: Write review-data test for disabled mode**

```ts
import { describe, expect, it } from "vitest";
import { buildWorksCouncilPortalModel } from "./review-data";

describe("works council review data", () => {
	it("returns disabled state without domain data when mode is disabled", async () => {
		const model = await buildWorksCouncilPortalModel({
			organizationId: "org-1",
			actorUserId: "user-1",
			dateRangeStart: new Date("2026-05-01T00:00:00.000Z"),
			dateRangeEnd: new Date("2026-05-31T23:59:59.999Z"),
			settings: {
				enabled: false,
				identityVisibility: "aggregated",
				absenceVisibility: "hidden",
				exportEnabled: false,
				minimumAggregationThreshold: 5,
				visibleTeamIds: [],
				visibleLocationIds: [],
			},
		});

		expect(model.state).toBe("disabled");
		expect(model.dashboard).toBeNull();
	});
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @z8/webapp test src/lib/works-council/review-data.test.ts`

Expected: FAIL because `./review-data` does not exist.

- [ ] **Step 3: Add review-data model builder**

Create `apps/webapp/src/lib/works-council/review-data.ts`:

```ts
import type { WorksCouncilAbsenceVisibility, WorksCouncilIdentityVisibility } from "@/db/schema";

export interface WorksCouncilSettingsSnapshot {
	enabled: boolean;
	identityVisibility: WorksCouncilIdentityVisibility;
	absenceVisibility: WorksCouncilAbsenceVisibility;
	exportEnabled: boolean;
	minimumAggregationThreshold: number;
	visibleTeamIds: string[];
	visibleLocationIds: string[];
}

export interface BuildWorksCouncilPortalModelInput {
	organizationId: string;
	actorUserId: string;
	dateRangeStart: Date;
	dateRangeEnd: Date;
	settings: WorksCouncilSettingsSnapshot;
}

export type WorksCouncilPortalModel =
	| { state: "disabled"; dashboard: null; changeLog: []; scheduleReview: [] }
	| {
			state: "ready";
			dashboard: {
				overtimeMinutes: number;
				breakRestRiskCount: number;
				schedulePublicationCount: number;
				scheduleChangeCount: number;
				complianceFindingCount: number;
				absenceCoveragePressureCount: number;
				policyChangeCount: number;
			};
			changeLog: Array<{ id: string; timestamp: string; eventType: string; actorLabel: string; summary: string }>;
			scheduleReview: Array<{ id: string; startsAt: string; endsAt: string; teamName: string | null; employeeName: string | null }>;
		};

export async function buildWorksCouncilPortalModel(
	input: BuildWorksCouncilPortalModelInput,
): Promise<WorksCouncilPortalModel> {
	if (!input.settings.enabled) {
		return { state: "disabled", dashboard: null, changeLog: [], scheduleReview: [] };
	}

	return {
		state: "ready",
		dashboard: {
			overtimeMinutes: 0,
			breakRestRiskCount: 0,
			schedulePublicationCount: 0,
			scheduleChangeCount: 0,
			complianceFindingCount: 0,
			absenceCoveragePressureCount: 0,
			policyChangeCount: 0,
		},
		changeLog: [],
		scheduleReview: [],
	};
}
```

- [ ] **Step 4: Add organization-scoped query tests**

Extend `apps/webapp/src/lib/works-council/review-data.test.ts` with a fixture-level query contract test:

```ts
it("uses organization and date range in every data request", async () => {
	const requests: Array<{ organizationId: string; dateRangeStart: Date; dateRangeEnd: Date }> = [];
	await buildWorksCouncilPortalModel({
		organizationId: "org-1",
		actorUserId: "user-1",
		dateRangeStart: new Date("2026-05-01T00:00:00.000Z"),
		dateRangeEnd: new Date("2026-05-31T23:59:59.999Z"),
		settings: {
			enabled: true,
			identityVisibility: "aggregated",
			absenceVisibility: "hidden",
			exportEnabled: false,
			minimumAggregationThreshold: 5,
			visibleTeamIds: [],
			visibleLocationIds: [],
		},
		collectQueryContract: (request) => requests.push(request),
	});

	expect(requests.length).toBeGreaterThan(0);
	expect(requests.every((request) => request.organizationId === "org-1")).toBe(true);
});
```

Update `BuildWorksCouncilPortalModelInput` to accept this test hook:

```ts
collectQueryContract?: (request: { organizationId: string; dateRangeStart: Date; dateRangeEnd: Date }) => void;
```

In `buildWorksCouncilPortalModel`, call the hook before each query group:

```ts
input.collectQueryContract?.({
	organizationId: input.organizationId,
	dateRangeStart: input.dateRangeStart,
	dateRangeEnd: input.dateRangeEnd,
});
```

Then replace the zero-valued dashboard fields with Drizzle aggregate queries. Start with audit-backed counts so the dashboard has real organization-scoped data before adding richer domain metrics:

```ts
const changeRows = await db
	.select({ id: auditLog.id, timestamp: auditLog.timestamp, action: auditLog.action, entityType: auditLog.entityType })
	.from(auditLog)
	.where(
		and(
			eq(auditLog.organizationId, input.organizationId),
			gte(auditLog.timestamp, input.dateRangeStart),
			lte(auditLog.timestamp, input.dateRangeEnd),
		),
	);
```

Map `changeRows` into `changeLog`, set `policyChangeCount` to changes whose `entityType` includes `policy`, and keep all later metric queries behind the same `organizationId` and date predicates.

- [ ] **Step 5: Add portal page**

Create `apps/webapp/src/app/[locale]/(app)/works-council/page.tsx`:

```tsx
import { WorksCouncilDashboard } from "@/components/works-council/works-council-dashboard";
import { getCurrentOrganizationIdOrThrow, getCurrentUserOrThrow } from "@/lib/auth-helpers";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";

function getDefaultRange() {
	const now = new Date();
	return {
		dateRangeStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
		dateRangeEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)),
	};
}

export default async function WorksCouncilPage() {
	const organizationId = await getCurrentOrganizationIdOrThrow();
	const user = await getCurrentUserOrThrow();
	const settings = await loadWorksCouncilSettings(organizationId);
	const range = getDefaultRange();
	const model = await buildWorksCouncilPortalModel({ organizationId, actorUserId: user.id, settings, ...range });

	return <WorksCouncilDashboard model={model} />;
}
```

- [ ] **Step 6: Add dashboard component**

Create `apps/webapp/src/components/works-council/works-council-dashboard.tsx`:

```tsx
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";

export function WorksCouncilDashboard({ model }: { model: WorksCouncilPortalModel }) {
	if (model.state === "disabled") {
		return (
			<section className="space-y-2">
				<h1 className="text-2xl font-semibold tracking-tight">Works Council</h1>
				<p className="text-muted-foreground">Works Council Mode is not enabled for this organization.</p>
			</section>
		);
	}

	return (
		<section className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Works Council</h1>
				<p className="text-muted-foreground">Privacy-filtered workforce review for the selected period.</p>
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				<div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Overtime</p><p className="text-2xl font-semibold">{model.dashboard.overtimeMinutes}</p></div>
				<div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Compliance findings</p><p className="text-2xl font-semibold">{model.dashboard.complianceFindingCount}</p></div>
				<div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Schedule changes</p><p className="text-2xl font-semibold">{model.dashboard.scheduleChangeCount}</p></div>
			</div>
		</section>
	);
}
```

- [ ] **Step 7: Run portal tests and commit**

Run: `pnpm --filter @z8/webapp test src/lib/works-council/review-data.test.ts src/components/works-council/works-council-dashboard.test.tsx`

Expected: PASS after adding the dashboard tests for disabled and ready render states.

```bash
git add apps/webapp/src/lib/works-council/review-data.ts apps/webapp/src/lib/works-council/review-data.test.ts apps/webapp/src/app/[locale]/(app)/works-council/page.tsx apps/webapp/src/components/works-council/works-council-dashboard.tsx apps/webapp/src/components/works-council/works-council-dashboard.test.tsx
git commit -m "feat: add works council portal"
```

## Task 5: Audited Export Route

**Files:**
- Modify: `apps/webapp/src/lib/audit-logger.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/works-council/export/route.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/works-council/export/route.test.ts`

- [ ] **Step 1: Add audit actions**

In `apps/webapp/src/lib/audit-logger.ts`, add enum members:

```ts
WORKS_COUNCIL_PORTAL_VIEWED = "works_council.portal_viewed",
WORKS_COUNCIL_SETTINGS_UPDATED = "works_council.settings_updated",
WORKS_COUNCIL_EXPORT_REQUESTED = "works_council.export_requested",
WORKS_COUNCIL_EXPORT_FAILED = "works_council.export_failed",
```

Add target types to `AuditLogEntry["targetType"]`:

```ts
| "works_council_settings"
| "works_council_export"
```

- [ ] **Step 2: Write route tests**

Create `apps/webapp/src/app/[locale]/(app)/works-council/export/route.test.ts` with route tests that replace auth/settings modules using `vi.mock` and assert:

```ts
expect(response.status).toBe(403);
expect(await response.text()).toContain("Works Council exports are disabled");
```

and for success:

```ts
expect(response.headers.get("content-type")).toContain("text/csv");
expect(response.headers.get("content-disposition")).toContain("works-council-review");
```

- [ ] **Step 3: Add CSV export route**

Create `apps/webapp/src/app/[locale]/(app)/works-council/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentOrganizationIdOrThrow, getCurrentUserOrThrow } from "@/lib/auth-helpers";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";

function csvEscape(value: string | number | null) {
	const text = String(value ?? "");
	return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
	const organizationId = await getCurrentOrganizationIdOrThrow();
	const user = await getCurrentUserOrThrow();
	const settings = await loadWorksCouncilSettings(organizationId);

	if (!settings.enabled || !settings.exportEnabled) {
		return new NextResponse("Works Council exports are disabled", { status: 403 });
	}

	const now = new Date();
	const dateRangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const dateRangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
	const model = await buildWorksCouncilPortalModel({ organizationId, actorUserId: user.id, settings, dateRangeStart, dateRangeEnd });

	const rows = [
		["metric", "value"],
		["state", model.state],
		["identity_visibility", settings.identityVisibility],
		["absence_visibility", settings.absenceVisibility],
	];
	const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

	return new NextResponse(csv, {
		headers: {
			"content-type": "text/csv; charset=utf-8",
			"content-disposition": "attachment; filename=\"works-council-review.csv\"",
		},
	});
}
```

- [ ] **Step 4: Persist export and access audit rows**

In `apps/webapp/src/app/[locale]/(app)/works-council/export/route.ts`, import `db`, `worksCouncilAccessAudit`, and `worksCouncilReviewExport` and insert rows before returning the CSV:

```ts
await db.insert(worksCouncilReviewExport).values({
	organizationId,
	requestedByUserId: user.id,
	dateRangeStart,
	dateRangeEnd,
	visibilitySnapshot: {
		identityVisibility: settings.identityVisibility,
		absenceVisibility: settings.absenceVisibility,
		minimumAggregationThreshold: settings.minimumAggregationThreshold,
		visibleTeamIds: settings.visibleTeamIds,
		visibleLocationIds: settings.visibleLocationIds,
	},
	status: "completed",
	rowCount: rows.length,
});

await db.insert(worksCouncilAccessAudit).values({
	organizationId,
	actorUserId: user.id,
	eventType: "export_requested",
	dateRangeStart,
	dateRangeEnd,
	metadata: { rowCount: rows.length },
});
```

Wrap export generation in `try/catch` after auth succeeds. In `catch`, insert:

```ts
await db.insert(worksCouncilAccessAudit).values({
	organizationId,
	actorUserId: user.id,
	eventType: "export_failed",
	dateRangeStart,
	dateRangeEnd,
	metadata: { message: error instanceof Error ? error.message : "Unknown export failure" },
});
```

Then return `new NextResponse("Works Council export failed", { status: 500 })`.

- [ ] **Step 5: Run route tests and commit**

Run: `pnpm --filter @z8/webapp test src/app/[locale]/(app)/works-council/export/route.test.ts`

Expected: PASS.

```bash
git add apps/webapp/src/lib/audit-logger.ts apps/webapp/src/app/[locale]/(app)/works-council/export/route.ts apps/webapp/src/app/[locale]/(app)/works-council/export/route.test.ts
git commit -m "feat: add works council review export"
```

## Task 6: Navigation, Access Gate, And Final Verification

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx`
- Test: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Write sidebar test**

Add a test to `apps/webapp/src/components/app-sidebar.test.tsx`:

```tsx
it("shows Works Council navigation only when allowed", () => {
	render(<AppSidebar showWorksCouncilNav />);
	expect(screen.getByRole("link", { name: /works council/i })).toHaveAttribute("href", "/works-council");

	cleanup();
	render(<AppSidebar showWorksCouncilNav={false} />);
	expect(screen.queryByRole("link", { name: /works council/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @z8/webapp test src/components/app-sidebar.test.tsx`

Expected: FAIL because `showWorksCouncilNav` is not supported.

- [ ] **Step 3: Add sidebar nav item**

In `apps/webapp/src/components/app-sidebar.tsx`, import a Tabler icon such as `IconGavel`, add prop `showWorksCouncilNav?: boolean`, default it to `false`, and add this to `navSecondary` before Settings:

```ts
...(showWorksCouncilNav
	? [
			{
				title: t("nav.worksCouncil", "Works Council"),
				url: "/works-council",
				icon: IconGavel,
			},
		]
	: []),
```

- [ ] **Step 4: Pass access from layout**

In `apps/webapp/src/app/[locale]/(app)/layout.tsx`, load the active organization and current ability using the existing layout helpers. Compute:

```ts
const showWorksCouncilNav = canViewWorksCouncilPortal(ability, currentOrganization.id);
```

Pass `showWorksCouncilNav={showWorksCouncilNav}` to `AppSidebar`.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @z8/webapp test src/components/app-sidebar.test.tsx src/lib/works-council/privacy.test.ts src/lib/works-council/settings.test.ts src/lib/works-council/review-data.test.ts`

Expected: PASS.

- [ ] **Step 6: Run broader verification**

Run: `pnpm --filter @z8/webapp test`

Expected: PASS.

Run: `CI=true pnpm build`

Expected: PASS. If this build requires Phase CLI secrets that are unavailable to agents, record the exact missing variables and skip the build with that reason.

- [ ] **Step 7: Commit navigation and verification fixes**

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/app/[locale]/(app)/layout.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat: expose works council navigation"
```

## Self-Review

- Spec coverage: the plan covers the dedicated portal, settings at `/settings/compliance/works-council`, least-privilege authorization, privacy transforms, schedule/change/dashboard surfaces, CSV review export, and audit hooks.
- Scope control: V1 stays read-only and does not add payroll, wage, messaging, negotiation, or legal guarantee workflows.
- Type consistency: the plan uses `WorksCouncil`, `worksCouncilSettings`, `worksCouncilAccessAudit`, `worksCouncilReviewExport`, `WorksCouncilIdentityVisibility`, and `WorksCouncilAbsenceVisibility` consistently across tasks.
- Implementation risk: the plan includes a verification step for CASL subject wrapping and a direct subject fallback, so callers keep stable exported helper names while tests prove the selected form.
