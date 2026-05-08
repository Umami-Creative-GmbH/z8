# Multi-Entity Organization Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add legal entities inside one Z8 organization so each entity can own payroll settings, holidays, policies, exports, and scoped admins.

**Architecture:** Introduce `legalEntityId` as a first-class boundary below `organizationId`. Start with schema and access helpers, then route entity-aware settings through one selected legal entity, and finally enforce the boundary in employees, holidays, policies, vacation, payroll, and exports. Existing organizations migrate into one default legal entity.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, PostgreSQL, Vitest, TanStack Form, Tolgee, Luxon.

---

## Scope Check

This feature touches several subsystems. Keep it as one implementation effort because each subsystem depends on the same `legalEntityId` boundary and access model, but execute it in slices. Do not add multi-entity branding, notifications, projects, billing, webhooks, or cross-entity payroll exports.

## File Structure

- Create: `apps/webapp/src/db/schema/legal-entity.ts` - legal entity tables and admin grants.
- Modify: `apps/webapp/src/db/schema/index.ts` - export new schema file.
- Modify: `apps/webapp/src/db/schema/relations.ts` - add legal entity relations and entity relations from existing tables.
- Modify: `apps/webapp/src/db/schema/organization.ts` - add `employee.legalEntityId`.
- Modify: `apps/webapp/src/db/schema/holiday.ts` - add `legalEntityId` to entity-owned holiday tables.
- Modify: `apps/webapp/src/db/schema/work-policy.ts` - add `legalEntityId` to work policies and assignments.
- Modify: `apps/webapp/src/db/schema/change-policy.ts` - add `legalEntityId` to change policies and assignments.
- Modify: `apps/webapp/src/db/schema/vacation.ts` - add `legalEntityId` to vacation policies and assignments.
- Modify: `apps/webapp/src/db/schema/payroll-export.ts` - add `legalEntityId` to payroll configs and jobs.
- Modify: `apps/webapp/src/db/schema/scheduled-export.ts` - add `legalEntityId` to scheduled exports and executions.
- Create: `apps/webapp/src/lib/legal-entities/default-entity.ts` - default entity lookup and creation helpers.
- Create: `apps/webapp/src/lib/legal-entities/access.ts` - selected-entity and authorization helpers.
- Create: `apps/webapp/src/lib/legal-entities/access.test.ts` - unit tests for helper behavior.
- Modify: `apps/webapp/src/lib/auth-helpers.ts` - include legal entity grants in principal context and settings access.
- Modify: `apps/webapp/src/lib/settings-access.ts` - represent `entityAdmin` settings access.
- Modify: `apps/webapp/src/components/settings/settings-config.ts` - add Legal Entities entry and allow entity admins on entity-owned settings pages.
- Modify: `apps/webapp/src/components/settings/settings-icons.ts` - add icon mapping if the selected icon is not already mapped.
- Create: `apps/webapp/src/lib/validations/legal-entity.ts` - legal entity form schema.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/legal-entities/actions.ts` - legal entity CRUD and admin grant actions.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/legal-entities/page.tsx` - server page for legal entity settings.
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entities-management.tsx` - legal entity list and dialogs.
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entity-dialog.tsx` - create/edit legal entity form.
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entity-admins-card.tsx` - entity admin grant management.
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entity-selector.tsx` - shared selector for entity-owned settings.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts` - require and validate employee legal entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx` - load entity filters and pass selected entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/new/page.tsx` - load default entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx` - restrict entity admin reads and moves.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts` - scope holiday reads/writes by legal entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/page.tsx` - use selected entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts` - scope work policy reads/writes by legal entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/page.tsx` - use selected entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/actions.ts` - scope change policies by legal entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx` - use selected entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts` - scope vacation settings by legal entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx` - use selected entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts` - scope payroll config and jobs by legal entity.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/page.tsx` - use selected entity.
- Modify: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts` - calculate readiness per legal entity.
- Modify: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts` - test entity-specific readiness.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/scheduled-exports/actions.ts` - scope scheduled payroll exports by legal entity.
- Modify: `apps/webapp/src/lib/scheduled-exports/application/executors/payroll-export-executor.ts` - execute payroll exports for one legal entity.
- Modify: existing tests beside changed files.

---

### Task 1: Schema Boundary

**Files:**
- Create: `apps/webapp/src/db/schema/legal-entity.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/organization.ts`
- Modify: `apps/webapp/src/db/schema/holiday.ts`
- Modify: `apps/webapp/src/db/schema/work-policy.ts`
- Modify: `apps/webapp/src/db/schema/change-policy.ts`
- Modify: `apps/webapp/src/db/schema/vacation.ts`
- Modify: `apps/webapp/src/db/schema/payroll-export.ts`
- Modify: `apps/webapp/src/db/schema/scheduled-export.ts`

- [ ] **Step 1: Write schema smoke tests**

Create `apps/webapp/src/db/schema/legal-entity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	employee,
	holiday,
	holidayCategory,
	holidayPreset,
	holidayAssignment,
	holidayPresetAssignment,
	legalEntity,
	legalEntityAdmin,
	payrollExportConfig,
	payrollExportJob,
	scheduledExport,
	workPolicy,
	workPolicyAssignment,
	changePolicy,
	changePolicyAssignment,
	vacationAllowance,
	vacationPolicyAssignment,
} from "@/db/schema";

describe("legal entity schema", () => {
	it("exports the legal entity tables", () => {
		expect(legalEntity).toBeDefined();
		expect(legalEntityAdmin).toBeDefined();
	});

	it("adds legalEntityId to employee and entity-owned tables", () => {
		const tables = [
			employee,
			holidayCategory,
			holiday,
			holidayPreset,
			holidayAssignment,
			holidayPresetAssignment,
			workPolicy,
			workPolicyAssignment,
			changePolicy,
			changePolicyAssignment,
			vacationAllowance,
			vacationPolicyAssignment,
			payrollExportConfig,
			payrollExportJob,
			scheduledExport,
		];

		for (const table of tables) {
			expect(table.legalEntityId).toBeDefined();
		}
	});
});
```

- [ ] **Step 2: Run the schema smoke tests and verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/db/schema/legal-entity.test.ts`

Expected: FAIL because `legalEntity` is not exported and `legalEntityId` is missing.

- [ ] **Step 3: Add legal entity tables**

Create `apps/webapp/src/db/schema/legal-entity.ts`:

```ts
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

export const legalEntity = pgTable(
	"legal_entity",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		legalName: text("legal_name"),
		registrationNumber: text("registration_number"),
		taxId: text("tax_id"),
		countryCode: text("country_code"),
		street: text("street"),
		city: text("city"),
		postalCode: text("postal_code"),
		country: text("country"),
		defaultCurrency: text("default_currency").default("EUR").notNull(),
		timezone: text("timezone").default("Europe/Berlin").notNull(),
		isDefault: boolean("is_default").default(false).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("legalEntity_organizationId_idx").on(table.organizationId),
		index("legalEntity_isActive_idx").on(table.isActive),
		uniqueIndex("legalEntity_org_name_idx").on(table.organizationId, table.name),
		uniqueIndex("legalEntity_org_default_idx")
			.on(table.organizationId)
			.where(sql`is_default = true AND is_active = true`),
	],
);

export const legalEntityAdmin = pgTable(
	"legal_entity_admin",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		legalEntityId: uuid("legal_entity_id")
			.notNull()
			.references(() => legalEntity.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
	},
	(table) => [
		index("legalEntityAdmin_organizationId_idx").on(table.organizationId),
		index("legalEntityAdmin_legalEntityId_idx").on(table.legalEntityId),
		uniqueIndex("legalEntityAdmin_entity_employee_idx").on(table.legalEntityId, table.employeeId),
	],
);
```

Add the missing import in the new file:

```ts
import { sql } from "drizzle-orm";
```

Modify `apps/webapp/src/db/schema/index.ts`:

```ts
export * from "./legal-entity";
```

- [ ] **Step 4: Add legalEntityId columns**

In each schema file listed for this task, add this import when needed:

```ts
import { legalEntity } from "./legal-entity";
```

Add this column to each entity-owned table:

```ts
legalEntityId: uuid("legal_entity_id")
	.notNull()
	.references(() => legalEntity.id, { onDelete: "cascade" }),
```

For `employee`, use `onDelete: "restrict"`:

```ts
legalEntityId: uuid("legal_entity_id")
	.notNull()
	.references(() => legalEntity.id, { onDelete: "restrict" }),
```

Add indexes beside existing `organizationId` indexes:

```ts
index("<tableName>_legalEntityId_idx").on(table.legalEntityId),
index("<tableName>_org_entity_idx").on(table.organizationId, table.legalEntityId),
```

Update unique indexes for entity-owned names/defaults. For example, in `workPolicy`:

```ts
uniqueIndex("workPolicy_org_entity_name_idx").on(table.organizationId, table.legalEntityId, table.name),
```

In assignment tables, update entity-wide default indexes. For example, in `workPolicyAssignment`:

```ts
uniqueIndex("workPolicyAssignment_entity_default_idx")
	.on(table.organizationId, table.legalEntityId, table.assignmentType)
	.where(sql`assignment_type = 'organization' AND is_active = true`),
```

- [ ] **Step 5: Run schema smoke tests**

Run: `pnpm --dir apps/webapp vitest run src/db/schema/legal-entity.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit schema boundary**

```bash
git add apps/webapp/src/db/schema/legal-entity.ts apps/webapp/src/db/schema/legal-entity.test.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/organization.ts apps/webapp/src/db/schema/holiday.ts apps/webapp/src/db/schema/work-policy.ts apps/webapp/src/db/schema/change-policy.ts apps/webapp/src/db/schema/vacation.ts apps/webapp/src/db/schema/payroll-export.ts apps/webapp/src/db/schema/scheduled-export.ts
git commit -m "feat: add legal entity schema boundary"
```

---

### Task 2: Schema Relations And Default Entity Helpers

**Files:**
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/src/lib/legal-entities/default-entity.ts`
- Create: `apps/webapp/src/lib/legal-entities/default-entity.test.ts`

- [ ] **Step 1: Write default entity helper tests**

Create `apps/webapp/src/lib/legal-entities/default-entity.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { buildDefaultLegalEntityValues } from "./default-entity";

describe("buildDefaultLegalEntityValues", () => {
	it("uses organization display data and safe defaults", () => {
		expect(
			buildDefaultLegalEntityValues({
				organizationId: "org-1",
				organizationName: "Acme Group",
				createdBy: "user-1",
			}),
		).toEqual({
			organizationId: "org-1",
			name: "Acme Group",
			legalName: "Acme Group",
			defaultCurrency: "EUR",
			timezone: "Europe/Berlin",
			isDefault: true,
			isActive: true,
			createdBy: "user-1",
			updatedBy: "user-1",
		});
	});
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/lib/legal-entities/default-entity.test.ts`

Expected: FAIL because `default-entity.ts` does not exist.

- [ ] **Step 3: Implement default entity helpers**

Create `apps/webapp/src/lib/legal-entities/default-entity.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntity } from "@/db/schema";

export interface BuildDefaultLegalEntityValuesInput {
	organizationId: string;
	organizationName: string;
	createdBy: string | null;
}

export function buildDefaultLegalEntityValues(input: BuildDefaultLegalEntityValuesInput) {
	return {
		organizationId: input.organizationId,
		name: input.organizationName,
		legalName: input.organizationName,
		defaultCurrency: "EUR",
		timezone: "Europe/Berlin",
		isDefault: true,
		isActive: true,
		createdBy: input.createdBy,
		updatedBy: input.createdBy,
	};
}

export async function getDefaultLegalEntity(organizationId: string) {
	const [entity] = await db
		.select()
		.from(legalEntity)
		.where(
			and(
				eq(legalEntity.organizationId, organizationId),
				eq(legalEntity.isDefault, true),
				eq(legalEntity.isActive, true),
			),
		)
		.limit(1);

	return entity ?? null;
}
```

- [ ] **Step 4: Add relations**

Modify `apps/webapp/src/db/schema/relations.ts` imports:

```ts
import { legalEntity, legalEntityAdmin } from "./legal-entity";
```

Add to `organizationRelations`:

```ts
legalEntities: many(legalEntity),
legalEntityAdmins: many(legalEntityAdmin),
```

Add relation exports:

```ts
export const legalEntityRelations = relations(legalEntity, ({ one, many }) => ({
	organization: one(organization, {
		fields: [legalEntity.organizationId],
		references: [organization.id],
	}),
	employees: many(employee),
	admins: many(legalEntityAdmin),
	holidayCategories: many(holidayCategory),
	holidays: many(holiday),
	holidayPresets: many(holidayPreset),
	workPolicies: many(workPolicy),
	workPolicyAssignments: many(workPolicyAssignment),
	changePolicies: many(changePolicy),
	changePolicyAssignments: many(changePolicyAssignment),
	vacationAllowances: many(vacationAllowance),
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	payrollExportConfigs: many(payrollExportConfig),
	payrollExportJobs: many(payrollExportJob),
}));

export const legalEntityAdminRelations = relations(legalEntityAdmin, ({ one }) => ({
	organization: one(organization, {
		fields: [legalEntityAdmin.organizationId],
		references: [organization.id],
	}),
	legalEntity: one(legalEntity, {
		fields: [legalEntityAdmin.legalEntityId],
		references: [legalEntity.id],
	}),
	employee: one(employee, {
		fields: [legalEntityAdmin.employeeId],
		references: [employee.id],
	}),
}));
```

Add legal entity `one(...)` relations to employee and each entity-owned table relation that already has an organization relation:

```ts
legalEntity: one(legalEntity, {
	fields: [employee.legalEntityId],
	references: [legalEntity.id],
}),
```

- [ ] **Step 5: Run tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/legal-entities/default-entity.test.ts src/db/schema/legal-entity.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit relations and helpers**

```bash
git add apps/webapp/src/db/schema/relations.ts apps/webapp/src/lib/legal-entities/default-entity.ts apps/webapp/src/lib/legal-entities/default-entity.test.ts
git commit -m "feat: add legal entity relations and defaults"
```

---

### Task 3: Access Model

**Files:**
- Create: `apps/webapp/src/lib/legal-entities/access.ts`
- Create: `apps/webapp/src/lib/legal-entities/access.test.ts`
- Modify: `apps/webapp/src/lib/auth-helpers.ts`
- Modify: `apps/webapp/src/lib/settings-access.ts`

- [ ] **Step 1: Write access helper tests**

Create `apps/webapp/src/lib/legal-entities/access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canAccessLegalEntity, resolveSelectedLegalEntityId } from "./access";

describe("canAccessLegalEntity", () => {
	it("allows org admins to access every legal entity", () => {
		expect(canAccessLegalEntity({ isOrgAdmin: true, allowedLegalEntityIds: [] }, "entity-a")).toBe(true);
	});

	it("allows entity admins only for granted legal entities", () => {
		expect(canAccessLegalEntity({ isOrgAdmin: false, allowedLegalEntityIds: ["entity-a"] }, "entity-a")).toBe(true);
		expect(canAccessLegalEntity({ isOrgAdmin: false, allowedLegalEntityIds: ["entity-a"] }, "entity-b")).toBe(false);
	});
});

describe("resolveSelectedLegalEntityId", () => {
	it("uses requested entity when allowed", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: "entity-b",
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-b"],
			}),
		).toBe("entity-b");
	});

	it("falls back to default for org admins without a requested entity", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: null,
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: true,
				allowedLegalEntityIds: [],
			}),
		).toBe("entity-a");
	});

	it("uses the first allowed entity for entity admins without a requested entity", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: null,
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-c"],
			}),
		).toBe("entity-c");
	});

	it("rejects unauthorized requested entities", () => {
		expect(() =>
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: "entity-x",
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-c"],
			}),
		).toThrow("You do not have access to this legal entity.");
	});
});
```

- [ ] **Step 2: Run access helper tests and verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/lib/legal-entities/access.test.ts`

Expected: FAIL because `access.ts` does not exist.

- [ ] **Step 3: Implement access helpers**

Create `apps/webapp/src/lib/legal-entities/access.ts`:

```ts
export interface LegalEntityAccessScope {
	isOrgAdmin: boolean;
	allowedLegalEntityIds: string[];
}

export function canAccessLegalEntity(scope: LegalEntityAccessScope, legalEntityId: string) {
	return scope.isOrgAdmin || scope.allowedLegalEntityIds.includes(legalEntityId);
}

export interface ResolveSelectedLegalEntityIdInput extends LegalEntityAccessScope {
	requestedLegalEntityId: string | null;
	defaultLegalEntityId: string;
}

export function resolveSelectedLegalEntityId(input: ResolveSelectedLegalEntityIdInput) {
	if (input.requestedLegalEntityId) {
		if (!canAccessLegalEntity(input, input.requestedLegalEntityId)) {
			throw new Error("You do not have access to this legal entity.");
		}

		return input.requestedLegalEntityId;
	}

	if (input.isOrgAdmin) {
		return input.defaultLegalEntityId;
	}

	const [firstAllowedEntity] = input.allowedLegalEntityIds;
	if (!firstAllowedEntity) {
		throw new Error("No legal entity access is available for this user.");
	}

	return firstAllowedEntity;
}
```

- [ ] **Step 4: Extend auth principal context**

In `apps/webapp/src/lib/auth-helpers.ts`, import legal entity admin grants:

```ts
import { legalEntityAdmin } from "@/db/schema";
```

Add `legalEntityAdminIds: string[]` to `PrincipalContext` and every returned principal object. For platform admin and no-org cases, return `legalEntityAdminIds: []`.

After loading `employeeRecord`, load entity grants:

```ts
let legalEntityAdminIds: string[] = [];

if (employeeRecord) {
	const grantRecords = await db
		.select({ legalEntityId: legalEntityAdmin.legalEntityId })
		.from(legalEntityAdmin)
		.where(
			and(
				eq(legalEntityAdmin.organizationId, activeOrganizationId),
				eq(legalEntityAdmin.employeeId, employeeRecord.id),
			),
		);

	legalEntityAdminIds = grantRecords.map((grant) => grant.legalEntityId);
}
```

Return it from the active-org principal:

```ts
legalEntityAdminIds,
```

- [ ] **Step 5: Extend settings access tiers**

In `apps/webapp/src/lib/settings-access.ts`, add `entityAdmin` to the `SettingsAccessTier` union between `manager` and `orgAdmin`. Update `hasSettingsAccessTier` order so `entityAdmin` can access entity-owned admin settings but not org-admin-only settings.

Use this order:

```ts
const SETTINGS_ACCESS_RANK: Record<SettingsAccessTier, number> = {
	none: 0,
	member: 1,
	manager: 2,
	entityAdmin: 3,
	orgAdmin: 4,
};
```

Update the resolver so a user with legal entity admin grants and no org-admin role resolves to `entityAdmin`.

- [ ] **Step 6: Run access tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/legal-entities/access.test.ts src/lib/settings-access.test.ts`

Expected: PASS. If `src/lib/settings-access.test.ts` does not exist, run `pnpm --dir apps/webapp vitest run src/lib/legal-entities/access.test.ts src/components/settings/settings-config.test.ts`.

- [ ] **Step 7: Commit access model**

```bash
git add apps/webapp/src/lib/legal-entities/access.ts apps/webapp/src/lib/legal-entities/access.test.ts apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/lib/settings-access.ts
git commit -m "feat: add legal entity access model"
```

---

### Task 4: Legal Entities Settings Page

**Files:**
- Create: `apps/webapp/src/lib/validations/legal-entity.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/legal-entities/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/legal-entities/page.tsx`
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entities-management.tsx`
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entity-dialog.tsx`
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entity-admins-card.tsx`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/components/settings/settings-icons.ts`
- Test: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Add settings config test**

In `apps/webapp/src/components/settings/settings-config.test.ts`, add:

```ts
it("shows legal entities to organization admins only", () => {
	const entries = resolveSettingsEntries({ accessTier: "orgAdmin" });
	expect(entries.some((entry) => entry.id === "legal-entities")).toBe(true);

	const entityAdminEntries = resolveSettingsEntries({ accessTier: "entityAdmin" });
	expect(entityAdminEntries.some((entry) => entry.id === "legal-entities")).toBe(false);
});
```

- [ ] **Step 2: Run the settings config test and verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/settings-config.test.ts`

Expected: FAIL because the `legal-entities` entry does not exist.

- [ ] **Step 3: Add settings entry**

Modify `apps/webapp/src/components/settings/settings-config.ts` by adding `building-bank` or an existing building icon value to `SettingsIconName`, then add this entry near the organization settings:

```ts
{
	id: "legal-entities",
	titleKey: "settings.legalEntities.title",
	titleDefault: "Legal Entities",
	descriptionKey: "settings.legalEntities.description",
	descriptionDefault: "Manage company entities, entity admins, and configuration readiness",
	href: "/settings/legal-entities",
	icon: "building",
	minimumTier: "orgAdmin",
	group: "organization",
},
```

- [ ] **Step 4: Add validation schema**

Create `apps/webapp/src/lib/validations/legal-entity.ts`:

```ts
import { z } from "zod";

export const legalEntityFormSchema = z.object({
	name: z.string().trim().min(1, "Name is required"),
	legalName: z.string().trim().optional(),
	registrationNumber: z.string().trim().optional(),
	taxId: z.string().trim().optional(),
	countryCode: z.string().trim().length(2, "Use a two-letter country code").optional(),
	street: z.string().trim().optional(),
	city: z.string().trim().optional(),
	postalCode: z.string().trim().optional(),
	country: z.string().trim().optional(),
	defaultCurrency: z.string().trim().length(3, "Use a three-letter currency code"),
	timezone: z.string().trim().min(1, "Timezone is required"),
	isActive: z.boolean(),
});

export type LegalEntityFormValues = z.infer<typeof legalEntityFormSchema>;
```

- [ ] **Step 5: Add server actions**

Create `apps/webapp/src/app/[locale]/(app)/settings/legal-entities/actions.ts`:

```ts
"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employee, legalEntity, legalEntityAdmin } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { legalEntityFormSchema, type LegalEntityFormValues } from "@/lib/validations/legal-entity";

export async function getLegalEntities() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return db.select().from(legalEntity).where(eq(legalEntity.organizationId, organizationId));
}

export async function createLegalEntity(values: LegalEntityFormValues) {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const parsed = legalEntityFormSchema.parse(values);

	await db.insert(legalEntity).values({
		organizationId,
		...parsed,
		isDefault: false,
		createdBy: authContext.user.id,
		updatedBy: authContext.user.id,
	});

	revalidatePath("/settings/legal-entities");
}

export async function updateLegalEntity(id: string, values: LegalEntityFormValues) {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const parsed = legalEntityFormSchema.parse(values);

	await db
		.update(legalEntity)
		.set({ ...parsed, updatedBy: authContext.user.id })
		.where(and(eq(legalEntity.id, id), eq(legalEntity.organizationId, organizationId)));

	revalidatePath("/settings/legal-entities");
}

export async function setDefaultLegalEntity(id: string) {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();

	await db.transaction(async (tx) => {
		await tx
			.update(legalEntity)
			.set({ isDefault: false, updatedBy: authContext.user.id })
			.where(and(eq(legalEntity.organizationId, organizationId), ne(legalEntity.id, id)));

		await tx
			.update(legalEntity)
			.set({ isDefault: true, isActive: true, updatedBy: authContext.user.id })
			.where(and(eq(legalEntity.organizationId, organizationId), eq(legalEntity.id, id)));
	});

	revalidatePath("/settings/legal-entities");
}

export async function grantLegalEntityAdmin(legalEntityId: string, employeeId: string) {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();

	const [employeeRecord] = await db
		.select({ id: employee.id, entityId: employee.legalEntityId })
		.from(employee)
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);

	if (!employeeRecord || employeeRecord.entityId !== legalEntityId) {
		throw new Error("Employee must belong to the selected legal entity.");
	}

	await db.insert(legalEntityAdmin).values({
		organizationId,
		legalEntityId,
		employeeId,
		createdBy: authContext.user.id,
	});

	revalidatePath("/settings/legal-entities");
}
```

- [ ] **Step 6: Add page and management component**

Create `apps/webapp/src/app/[locale]/(app)/settings/legal-entities/page.tsx`:

```tsx
import { getLegalEntities } from "./actions";
import { LegalEntitiesManagement } from "@/components/settings/legal-entities/legal-entities-management";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function LegalEntitiesPage() {
	await requireOrgAdminSettingsAccess();
	const entities = await getLegalEntities();

	return <LegalEntitiesManagement entities={entities} />;
}
```

Create `apps/webapp/src/components/settings/legal-entities/legal-entities-management.tsx`:

```tsx
"use client";

import type { legalEntity } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LegalEntitiesManagementProps {
	entities: (typeof legalEntity.$inferSelect)[];
}

export function LegalEntitiesManagement({ entities }: LegalEntitiesManagementProps) {
	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-6xl space-y-6">
				<div>
					<h1 className="text-3xl font-semibold">Legal Entities</h1>
					<p className="text-muted-foreground">Manage entity-specific payroll, policies, holidays, and admins.</p>
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					{entities.map((entity) => (
						<Card key={entity.id}>
							<CardHeader>
								<CardTitle>{entity.name}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm text-muted-foreground">
								<p>{entity.legalName ?? entity.name}</p>
								<p>{entity.isDefault ? "Default entity" : "Entity"}</p>
								<p>{entity.isActive ? "Active" : "Inactive"}</p>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</div>
	);
}
```

Create placeholder-free component files for dialogs with exported shells so later tasks can add interactivity without broken imports:

```tsx
"use client";

export function LegalEntityDialog() {
	return null;
}
```

Use the same pattern for `legal-entity-admins-card.tsx`.

- [ ] **Step 7: Run tests**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/settings-config.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit legal entities settings page**

```bash
git add apps/webapp/src/lib/validations/legal-entity.ts apps/webapp/src/app/[locale]/\(app\)/settings/legal-entities apps/webapp/src/components/settings/legal-entities apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-icons.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat: add legal entities settings page"
```

---

### Task 5: Shared Legal Entity Selection

**Files:**
- Create: `apps/webapp/src/components/settings/legal-entities/legal-entity-selector.tsx`
- Modify: `apps/webapp/src/lib/legal-entities/access.ts`
- Modify: entity-owned settings pages listed in File Structure.

- [ ] **Step 1: Write selector tests**

Create `apps/webapp/src/components/settings/legal-entities/legal-entity-selector.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegalEntitySelector } from "./legal-entity-selector";

const entities = [
	{ id: "entity-a", name: "Germany GmbH" },
	{ id: "entity-b", name: "Portugal Lda" },
];

describe("LegalEntitySelector", () => {
	it("renders nothing when there is one entity", () => {
		const { container } = render(<LegalEntitySelector entities={[entities[0]]} selectedLegalEntityId="entity-a" />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders a legal entity selector when multiple entities are available", () => {
		render(<LegalEntitySelector entities={entities} selectedLegalEntityId="entity-a" />);
		expect(screen.getByLabelText("Legal entity")).toBeInTheDocument();
		expect(screen.getByText("Germany GmbH")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run selector tests and verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/legal-entities/legal-entity-selector.test.tsx`

Expected: FAIL because the selector file does not exist.

- [ ] **Step 3: Implement selector**

Create `apps/webapp/src/components/settings/legal-entities/legal-entity-selector.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LegalEntitySelectorEntity {
	id: string;
	name: string;
}

interface LegalEntitySelectorProps {
	entities: LegalEntitySelectorEntity[];
	selectedLegalEntityId: string;
}

export function LegalEntitySelector({ entities, selectedLegalEntityId }: LegalEntitySelectorProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	if (entities.length <= 1) {
		return null;
	}

	return (
		<div className="grid gap-2 sm:max-w-xs">
			<Label htmlFor="legal-entity-selector">Legal entity</Label>
			<Select
				value={selectedLegalEntityId}
				onValueChange={(value) => {
					const next = new URLSearchParams(searchParams.toString());
					next.set("legalEntityId", value);
					router.push(`${pathname}?${next.toString()}`);
				}}
			>
				<SelectTrigger id="legal-entity-selector">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{entities.map((entity) => (
						<SelectItem key={entity.id} value={entity.id}>
							{entity.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
```

- [ ] **Step 4: Add server helper for selected entity context**

In `apps/webapp/src/lib/legal-entities/access.ts`, add:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { legalEntity } from "@/db/schema";
import { getDefaultLegalEntity } from "./default-entity";

export async function getLegalEntitySelectionContext(input: {
	organizationId: string;
	requestedLegalEntityId: string | null;
	isOrgAdmin: boolean;
	allowedLegalEntityIds: string[];
}) {
	const defaultEntity = await getDefaultLegalEntity(input.organizationId);

	if (!defaultEntity) {
		throw new Error("No default legal entity exists for this organization.");
	}

	const selectedLegalEntityId = resolveSelectedLegalEntityId({
		requestedLegalEntityId: input.requestedLegalEntityId,
		defaultLegalEntityId: defaultEntity.id,
		isOrgAdmin: input.isOrgAdmin,
		allowedLegalEntityIds: input.allowedLegalEntityIds,
	});

	const whereClause = input.isOrgAdmin
		? eq(legalEntity.organizationId, input.organizationId)
		: and(
				eq(legalEntity.organizationId, input.organizationId),
				inArray(legalEntity.id, input.allowedLegalEntityIds),
			);

	const entities = await db.select().from(legalEntity).where(whereClause);

	return { entities, selectedLegalEntityId };
}
```

- [ ] **Step 5: Add selector to entity-owned settings pages**

For each page in holidays, work policies, change policies, vacation, payroll export, and scheduled exports, read `searchParams.legalEntityId`, call `getLegalEntitySelectionContext`, pass `selectedLegalEntityId` into queries/actions, and render:

```tsx
<LegalEntitySelector entities={entities} selectedLegalEntityId={selectedLegalEntityId} />
```

Place it below the page title and above the management component.

- [ ] **Step 6: Run selector tests**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/legal-entities/legal-entity-selector.test.tsx src/lib/legal-entities/access.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit selection flow**

```bash
git add apps/webapp/src/components/settings/legal-entities/legal-entity-selector.tsx apps/webapp/src/components/settings/legal-entities/legal-entity-selector.test.tsx apps/webapp/src/lib/legal-entities/access.ts apps/webapp/src/app/[locale]/\(app\)/settings/holidays/page.tsx apps/webapp/src/app/[locale]/\(app\)/settings/work-policies/page.tsx apps/webapp/src/app/[locale]/\(app\)/settings/change-policies/page.tsx apps/webapp/src/app/[locale]/\(app\)/settings/vacation/page.tsx apps/webapp/src/app/[locale]/\(app\)/settings/payroll-export/page.tsx apps/webapp/src/app/[locale]/\(app\)/settings/scheduled-exports/page.tsx
git commit -m "feat: add legal entity selection for settings"
```

---

### Task 6: Employee Legal Entity Assignment

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/new/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- Modify: employee form component used by these pages.

- [ ] **Step 1: Write employee action tests**

Add tests beside existing employee action tests, or create `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.legal-entity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertCanAssignEmployeeLegalEntity } from "./actions";

describe("assertCanAssignEmployeeLegalEntity", () => {
	it("allows org admins to assign any entity in the organization", () => {
		expect(() =>
			assertCanAssignEmployeeLegalEntity({
				isOrgAdmin: true,
				currentLegalEntityId: "entity-a",
				nextLegalEntityId: "entity-b",
				allowedLegalEntityIds: [],
			}),
		).not.toThrow();
	});

	it("prevents entity admins from moving employees between legal entities", () => {
		expect(() =>
			assertCanAssignEmployeeLegalEntity({
				isOrgAdmin: false,
				currentLegalEntityId: "entity-a",
				nextLegalEntityId: "entity-b",
				allowedLegalEntityIds: ["entity-a"],
			}),
		).toThrow("Only organization admins can move employees between legal entities.");
	});
});
```

- [ ] **Step 2: Run employee tests and verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/employees/actions.legal-entity.test.ts`

Expected: FAIL because `assertCanAssignEmployeeLegalEntity` is missing.

- [ ] **Step 3: Add assignment guard**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`, export:

```ts
export function assertCanAssignEmployeeLegalEntity(input: {
	isOrgAdmin: boolean;
	currentLegalEntityId: string | null;
	nextLegalEntityId: string;
	allowedLegalEntityIds: string[];
}) {
	if (input.isOrgAdmin) {
		return;
	}

	if (input.currentLegalEntityId !== input.nextLegalEntityId) {
		throw new Error("Only organization admins can move employees between legal entities.");
	}

	if (!input.allowedLegalEntityIds.includes(input.nextLegalEntityId)) {
		throw new Error("You do not have access to this legal entity.");
	}
}
```

- [ ] **Step 4: Update employee create and update actions**

Require `legalEntityId` in employee create/update payloads. On create, default to `getDefaultLegalEntity(organizationId)` when no explicit value is present. On update, call `assertCanAssignEmployeeLegalEntity` before writing.

When querying employees for entity admins, add:

```ts
inArray(employee.legalEntityId, allowedLegalEntityIds)
```

When querying employees for org admins with a selected filter, add:

```ts
eq(employee.legalEntityId, selectedLegalEntityId)
```

- [ ] **Step 5: Update employee forms and pages**

Load available legal entities for the current user and pass them to the employee form. Add a required select field named `legalEntityId`. Disable the field when the current user is not an org admin and the employee already exists.

Use this field shape:

```tsx
<form.Field name="legalEntityId">
	{(field) => (
		<div className="space-y-2">
			<Label htmlFor={field.name}>Legal entity</Label>
			<Select value={field.state.value} onValueChange={field.handleChange} disabled={!canMoveLegalEntity}>
				<SelectTrigger id={field.name}>
					<SelectValue placeholder="Select legal entity" />
				</SelectTrigger>
				<SelectContent>
					{legalEntities.map((entity) => (
						<SelectItem key={entity.id} value={entity.id}>
							{entity.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)}
</form.Field>
```

- [ ] **Step 6: Run employee tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/employees/actions.legal-entity.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit employee assignment**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/employees apps/webapp/src/components/settings/*employee* apps/webapp/src/components/settings/*Employee*
git commit -m "feat: assign employees to legal entities"
```

---

### Task 7: Entity-Scoped Policies, Holidays, And Vacation

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/holiday-scope.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/policy-scope.ts`
- Test: existing tests beside these files.

- [ ] **Step 1: Add cross-entity assignment tests**

In `apps/webapp/src/app/[locale]/(app)/settings/work-policies/policy-scope.test.ts`, add:

```ts
import { assertSameLegalEntityTarget } from "./policy-scope";

it("rejects assigning a policy to an employee in another legal entity", () => {
	expect(() =>
		assertSameLegalEntityTarget({
			policyLegalEntityId: "entity-a",
			targetLegalEntityId: "entity-b",
			targetLabel: "employee",
		}),
	).toThrow("The selected employee belongs to a different legal entity.");
});
```

Add the same test to `holiday-scope.test.ts` with `holidayLegalEntityId` if that file exists; otherwise create it with the same assertion against the holiday helper.

- [ ] **Step 2: Run scope tests and verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/work-policies/policy-scope.test.ts src/app/[locale]/\(app\)/settings/holidays/holiday-scope.test.ts`

Expected: FAIL because the legal entity assertion helpers are missing.

- [ ] **Step 3: Add policy target helper**

In `apps/webapp/src/app/[locale]/(app)/settings/work-policies/policy-scope.ts`, add:

```ts
export function assertSameLegalEntityTarget(input: {
	policyLegalEntityId: string;
	targetLegalEntityId: string;
	targetLabel: "team" | "employee";
}) {
	if (input.policyLegalEntityId !== input.targetLegalEntityId) {
		throw new Error(`The selected ${input.targetLabel} belongs to a different legal entity.`);
	}
}
```

In holiday scope, add the same function with `holidayLegalEntityId` as the source field.

- [ ] **Step 4: Update reads and writes**

For each actions file, require `selectedLegalEntityId` for entity-owned reads and writes. Add both filters to every query:

```ts
and(
	eq(table.organizationId, organizationId),
	eq(table.legalEntityId, selectedLegalEntityId),
)
```

When creating entity-owned rows, write:

```ts
organizationId,
legalEntityId: selectedLegalEntityId,
```

When assigning to a team or employee, load the target and compare `target.legalEntityId` to `selectedLegalEntityId` with the helper from Step 3.

- [ ] **Step 5: Update UI language**

Replace visible labels that say `Organization assignment` on entity-owned assignment pages with `Entity-wide assignment`. Keep persisted enum values unchanged as `organization` to avoid churn.

- [ ] **Step 6: Run policy and holiday tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/work-policies/policy-scope.test.ts src/app/[locale]/\(app\)/settings/holidays/holiday-scope.test.ts src/components/settings/holiday-dialog.test.tsx src/components/settings/policy-assignment-surface.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit entity-scoped policy settings**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/holidays apps/webapp/src/app/[locale]/\(app\)/settings/work-policies apps/webapp/src/app/[locale]/\(app\)/settings/change-policies apps/webapp/src/app/[locale]/\(app\)/settings/vacation apps/webapp/src/components/settings
git commit -m "feat: scope policies and holidays by legal entity"
```

---

### Task 8: Payroll And Export Scoping

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/scheduled-exports/actions.ts`
- Modify: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts`
- Modify: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`
- Modify: `apps/webapp/src/lib/scheduled-exports/application/executors/payroll-export-executor.ts`

- [ ] **Step 1: Add payroll filter tests**

In `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.test.ts`, add or create:

```ts
import { describe, expect, it } from "vitest";
import { assertSingleLegalEntityPayrollFilter } from "./actions";

describe("assertSingleLegalEntityPayrollFilter", () => {
	it("accepts employees from the selected legal entity", () => {
		expect(() =>
			assertSingleLegalEntityPayrollFilter({
				selectedLegalEntityId: "entity-a",
				employees: [{ id: "emp-1", legalEntityId: "entity-a" }],
			}),
		).not.toThrow();
	});

	it("rejects mixed legal entity employee filters", () => {
		expect(() =>
			assertSingleLegalEntityPayrollFilter({
				selectedLegalEntityId: "entity-a",
				employees: [{ id: "emp-1", legalEntityId: "entity-b" }],
			}),
		).toThrow("Payroll exports can include employees from only one legal entity.");
	});
});
```

- [ ] **Step 2: Run payroll tests and verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/payroll-export/actions.test.ts`

Expected: FAIL because the assertion helper is missing.

- [ ] **Step 3: Add payroll assertion helper**

In `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts`, export:

```ts
export function assertSingleLegalEntityPayrollFilter(input: {
	selectedLegalEntityId: string;
	employees: { id: string; legalEntityId: string }[];
}) {
	const hasOtherEntity = input.employees.some(
		(employeeRecord) => employeeRecord.legalEntityId !== input.selectedLegalEntityId,
	);

	if (hasOtherEntity) {
		throw new Error("Payroll exports can include employees from only one legal entity.");
	}
}
```

- [ ] **Step 4: Scope payroll config and jobs**

In payroll export actions, add `legalEntityId` to config lookups, config writes, export job writes, and employee filter validation. Use:

```ts
and(
	eq(payrollExportConfig.organizationId, organizationId),
	eq(payrollExportConfig.legalEntityId, selectedLegalEntityId),
)
```

When creating a job, write:

```ts
organizationId,
legalEntityId: selectedLegalEntityId,
```

Include entity metadata in generated filenames:

```ts
const fileName = `${legalEntitySlug}-${formatId}-${rangeStart}-${rangeEnd}.csv`;
```

- [ ] **Step 5: Update payroll readiness**

Change `getPayrollReadiness` signature to require `legalEntityId`:

```ts
export async function getPayrollReadiness(input: {
	organizationId: string;
	legalEntityId: string;
}) {
	// existing checks filtered by both organizationId and legalEntityId
}
```

Update `get-payroll-readiness.test.ts` to assert that readiness queries include `legalEntityId` and do not treat another entity's config as ready.

- [ ] **Step 6: Scope scheduled payroll exports**

In scheduled export actions and payroll executor, require a `legalEntityId` for payroll scheduled exports. Reject execution if `scheduledExport.legalEntityId` is missing for report type `payroll`:

```ts
if (scheduledExport.reportType === "payroll" && !scheduledExport.legalEntityId) {
	throw new Error("Scheduled payroll exports require a legal entity.");
}
```

Pass `legalEntityId` into payroll job creation and employee queries.

- [ ] **Step 7: Run payroll/export tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/payroll-export/actions.test.ts src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit payroll scoping**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/payroll-export apps/webapp/src/app/[locale]/\(app\)/settings/scheduled-exports apps/webapp/src/lib/payroll-readiness apps/webapp/src/lib/scheduled-exports/application/executors/payroll-export-executor.ts
git commit -m "feat: scope payroll exports by legal entity"
```

---

### Task 9: Migration Script And Verification

**Files:**
- Create: `apps/webapp/drizzle/0010_legal_entities.sql`
- Modify: generated Drizzle metadata files if this repository tracks them.
- Test: all tests touched in previous tasks.

- [ ] **Step 1: Create migration SQL**

Create `apps/webapp/drizzle/0010_legal_entities.sql` with the tables and columns from Task 1. Include data migration in this order:

```sql
INSERT INTO legal_entity (id, organization_id, name, legal_name, default_currency, timezone, is_default, is_active, created_at, updated_at)
SELECT gen_random_uuid(), id, name, name, 'EUR', 'Europe/Berlin', true, true, now(), now()
FROM organization
WHERE NOT EXISTS (
  SELECT 1 FROM legal_entity WHERE legal_entity.organization_id = organization.id
);

UPDATE employee
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE employee.organization_id = legal_entity.organization_id
  AND legal_entity.is_default = true
  AND employee.legal_entity_id IS NULL;
```

Repeat the same update pattern for each entity-owned table:

```sql
UPDATE payroll_export_config
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE payroll_export_config.organization_id = legal_entity.organization_id
  AND legal_entity.is_default = true
  AND payroll_export_config.legal_entity_id IS NULL;
```

After every entity-owned table is backfilled, set `legal_entity_id` columns to `NOT NULL`.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --dir apps/webapp vitest run src/db/schema/legal-entity.test.ts src/lib/legal-entities/access.test.ts src/lib/legal-entities/default-entity.test.ts src/components/settings/legal-entities/legal-entity-selector.test.tsx src/components/settings/settings-config.test.ts src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: PASS.

- [ ] **Step 3: Run broader settings tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings src/components/settings`

Expected: PASS.

- [ ] **Step 4: Run quality checks**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

Run: `pnpm --dir apps/webapp build`

Expected: PASS.

- [ ] **Step 5: Commit migration and verification fixes**

```bash
git add apps/webapp/drizzle apps/webapp/src
git commit -m "feat: migrate existing data to legal entities"
```

---

## Self-Review

- Spec coverage: schema, default migration, org-admin and entity-admin access, settings page, stable `legalEntityId` query parameter, employee assignment, entity-scoped policies/holidays/vacation, payroll/export single-entity enforcement, inactive entity behavior, and tests are covered.
- Scope control: child Better Auth organizations, multiple entities per employee, cross-entity payroll exports, and entity-specific branding/webhooks/projects/billing are excluded.
- Type consistency: the plan consistently uses `legalEntityId`, `legalEntity`, `legalEntityAdmin`, `selectedLegalEntityId`, `entityAdmin`, and `legalEntityId` query parameters.
- Verification: each task includes failing tests first, passing tests after implementation, and a commit step.
